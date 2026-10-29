# PG Owner Mobile Application: 20-Week Master Build Plan

*Two repositories · Integer-paise accounting · Manual-confirm UPI · Solo developer roadmap*

---

## 1. Product Summary

An all-in-one property management app for PG (Paying Guest) owners, hostel proprietors and coliving operators.

- **Owner-only app.** Tenants don't install anything. They interact through WhatsApp messages, UPI payments and PDF receipts.
- **Speed-first workflows.** Tenant check-in with photo KYC in under 2 minutes, 1-tap WhatsApp rent reminders, photo sub-meter logging.
- **SaaS model.** 14-day free trial, then a monthly subscription.

| Plan | Price | Limits | Key features |
|---|---|---|---|
| Starter | ₹499/mo | 1 property, 30 beds | Bed matrix, auto rent invoices, WhatsApp reminders, camera KYC |
| Growth | ₹999/mo | 3 properties, 100 beds | Sub-meter electricity, expenses and live P&L, visitor log |
| Pro | ₹1,999/mo | Unlimited | Multi-staff logins, CSV reports, priority support |

> **Cost reality check.** The stack is near-zero for development, but not literally ₹0: Apple Developer ($99/yr), Google Play ($25 one-time), payment-gateway fees on subscriptions, and an always-on backend host once you charge customers.

---

## 2. Locked Architecture Decisions

| Parameter | Decision | Why |
|---|---|---|
| Repositories | Two separate repos: `pg-owner-backend`, `pg-owner-mobile` | Avoids Metro bundler symlink issues and monorepo config overhead |
| Backend | Node.js + Express + TypeScript + Mongoose + Zod | Strict validation, typed contracts |
| Mobile | Expo (latest stable SDK at init, TypeScript) + Expo Router + NativeWind v4 + TanStack Query v5 | File-based routing, fast styling, query caching |
| Money | Integer paise everywhere (`rentPaise`, `depositPaise`, `balancePaise`) | No floating-point rounding bugs; format to ₹ only in the UI |
| Multi-tenancy | Every query hard-scoped by `organization` via one shared helper/middleware | Prevents cross-organization data leaks |
| Rent collection | Manual-confirm UPI: the owner taps "Mark Received" after the bank/UPI SMS | 0% gateway fee; no auto-confirmation callback exists for plain UPI |
| WhatsApp | `https://wa.me/91XXXXXXXXXX?text=...` + native share sheet | $0; `upi://` links are not clickable in WhatsApp, so share the UPI ID as text and the QR as an image |
| SaaS billing | Web-based billing portal; the app is a login-only companion | Avoids in-app purchase fees. **Verify the current Apple and Google subscription/external-payment rules before launch.** |
| Offline | TanStack Query persistence (AsyncStorage) | Bed matrix and contacts load in low-signal basements |
| Hosting | Always-on cheap host (or Oracle Always-Free ARM) from the pilot onward; scheduled GitHub Action calls the invoice endpoint | Free-tier hosts sleep and miss cron jobs |

---

## 3. Repository Structure

### `pg-owner-backend`

```
pg-owner-backend/
├── src/
│   ├── config/         # DB connection, Cloudinary, env
│   ├── middleware/     # auth, enforceOrgScope, requireRole, enforceSubscription, errorHandler
│   ├── models/         # Organization, User, Subscription, Property, Room, Bed, Tenant,
│   │                   # BedAssignment, Invoice, Payment, DepositLedger, MeterReading, Expense
│   ├── controllers/    # auth, property, bed, checkin, invoice, payment, meter, expense
│   ├── routes/
│   ├── services/       # proration, transaction runner, receipt numbering
│   ├── types/          # TS interfaces and Zod schemas
│   └── server.ts
├── tests/              # Jest + Supertest (proration, tenant scoping, invoicing idempotency)
├── .env.example
├── tsconfig.json
└── package.json
```

### `pg-owner-mobile`

```
pg-owner-mobile/
├── app/                      # Expo Router
│   ├── (auth)/               # login.tsx, register.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── index.tsx         # Tab 1: Pulse dashboard
│   │   ├── matrix.tsx        # Tab 2: Visual bed grid
│   │   ├── dues.tsx          # Tab 3: Receivables + WhatsApp
│   │   └── more.tsx          # Tab 4: Expenses, meters, settings, subscription
│   ├── checkin/[bedId].tsx   # Quick check-in + camera KYC
│   ├── checkout/[tenantId].tsx
│   └── _layout.tsx           # QueryClientProvider + auth guard
├── src/
│   ├── api/                  # Axios instance, JWT interceptor, TanStack hooks
│   ├── components/           # BedChip, RoomCard, StatCard, UpiQrModal, EmptyState
│   ├── hooks/                # useAuth, useMatrix, useInvoices, useOfflineStatus
│   ├── utils/                # currency.ts, whatsapp.ts, pdfReceipt.ts
│   └── types/                # api.ts (mirrors backend types)
├── assets/                   # icon (1024x1024), splash
├── app.json
├── tsconfig.json
└── package.json
```

---

## 4. Data Model (all money in integer paise: ₹1,000 = 100000 paise)

```typescript
interface IOrganization {
  name: string; ownerName: string; phone: string; email: string;
  settings: {
    rentDueDay: number;          // e.g. 1 or 5
    gracePeriodDays: number;     // e.g. 5
    defaultLateFeePaise: number; // 10000 = ₹100
  };
}

interface ISubscription {
  organization: string;
  plan: 'starter' | 'growth' | 'pro';
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  trialEndsAt: Date;             // signup + 14 days
  currentPeriodEnd: Date;
  maxProperties: number;         // 1 / 3 / 999
  maxBeds: number;               // 30 / 100 / 9999
}

interface IProperty {
  organization: string; name: string;
  type: 'boys' | 'girls' | 'coliving';
  upiVpa: string;
  electricityRatePaisePerUnit: number; // 1200 = ₹12/unit
}

interface IRoom {
  property: string; floorNumber: number; roomNumber: string;
  sharingType: number;           // 1-4
  baseRentPaisePerBed: number;   // 850000 = ₹8,500
}

interface IBed {
  property: string; room: string;
  bedNumber: string;             // "201-A"
  status: 'available' | 'occupied' | 'notice_period' | 'maintenance';
  currentTenant?: string;
}

interface ITenant {
  organization: string; property: string; currentBed: string;
  fullName: string; phone: string; emergencyPhone: string;
  monthlyRentPaise: number; depositPaise: number; depositPaidPaise: number;
  kycDocType?: 'aadhaar' | 'pan' | 'passport' | 'voter_id';
  kycMaskedNumber?: string;      // store masked, not the full number
  kycDocUrl?: string;            // private/authenticated Cloudinary asset
  kycConsent: boolean;
  status: 'active' | 'notice_period' | 'checked_out';
}

interface IInvoice {
  organization: string; property: string; tenant: string;
  invoiceNumber: string; month: number; year: number; dueDate: Date;
  items: Array<{
    description: string;
    amountPaise: number;
    category: 'rent' | 'electricity' | 'mess' | 'late_fee' | 'damage';
  }>;
  totalAmountPaise: number; amountPaidPaise: number; balanceDuePaise: number;
  status: 'unpaid' | 'partially_paid' | 'paid' | 'canceled';
}
```

**Also needed (add as you reach each stage):** `Payment` (receipt number, method UPI/Cash/Bank, optional transaction ref), `BedAssignment` (history of who occupied which bed and when), `DepositLedger` (deposit received/refunded/deducted, separate from rent payments), `MeterReading`, `Expense`, `MaintenanceTicket`.

**Required indexes and rules**
- Unique compound index on Invoice: `{ tenant: 1, month: 1, year: 1 }` so the cron can never double-bill.
- Unique `invoiceNumber` and `receiptNumber`.
- Every collection indexed by `organization`.
- Check-in and checkout run inside Mongo transactions so `Bed.currentTenant` and `Tenant.currentBed` never disagree.

---

## 5. Core Business Logic

All results are rounded to whole paise. Decide the rounding rule once (round half up) and test it.

**Mid-month joiner proration.** A tenant joins on day `D` of a month with `T` days:

```
payablePaise = round( monthlyRentPaise × (T − D + 1) / T )
```

**Electricity split.** Units = current reading − previous reading. Room charge = units × rate per unit. Split the room charge **by days each tenant occupied the bed in the billing period**, not by equal shares, so mid-month joiners aren't overcharged. When the split doesn't divide evenly, give the leftover paise to the first tenant so the line items sum exactly to the room charge.

**Checkout settlement.**

```
netRefundablePaise = depositPaidPaise − (pendingInvoices + unbilledUtilities + damageCharges)
```

If the result is negative, the tenant owes that balance before vacating.

**Dashboard.** Net cashflow = total rent collected − total expenses (month to date).

---

## 6. REST API Contract

**Auth and subscription**
- `POST /api/auth/register-owner`: create organization + owner, start the 14-day trial
- `POST /api/auth/login`: email/phone + password, returns JWT
- `GET /api/auth/me`: profile and subscription status

**Properties and beds**
- `GET/POST /api/properties`
- `GET /api/properties/:id/matrix`: floor → room → bed with live status
- `POST /api/properties/:id/rooms`: create room, auto-generate beds
- `PUT /api/beds/:id/status`

**Tenants**
- `POST /api/checkins/quick`: transactional check-in (tenant, bed, deposit, first prorated invoice, KYC)
- `GET /api/tenants`, `GET /api/tenants/:id` (with payment ledger)
- `POST /api/checkouts/preview/:tenantId`, `POST /api/checkouts/confirm`

**Invoices and payments**
- `GET /api/invoices` (filters: overdue, unpaid, paid)
- `POST /api/invoices/generate-monthly`: idempotent, secured by a secret header
- `POST /api/payments/mark-paid`: supports partial payments, generates a sequential receipt number
- `GET /api/payments/:id/receipt`: data for on-device PDF generation

**Utilities and expenses**
- `POST /api/meters/readings`, `GET/POST /api/expenses`, `GET /api/dashboard/stats`

---

## 7. Screens

**Navigation:** Launch → Biometric unlock → Subscription guard → 4 tabs (Pulse, Matrix, Dues, More).

1. **Pulse dashboard.** Property selector, trial chip, collections vs expected, occupancy %, net profit, overdue banner, floating action button (Check-in, Record payment, Log expense, Record meter).
2. **Bed matrix.** Floor chips + "Vacant only". Room cards with AC/washroom badges. Bed chips: 🟢 vacant (shows rent) → opens check-in, 🔴 occupied (name, PAID/DUE) → tenant profile, 🟡 notice period (countdown), ⚪ maintenance.
3. **Quick check-in.** Camera KYC capture (compressed under 200 KB), name/phone/emergency phone, bed pre-filled, rent/deposit pre-filled from room rate, collect advance by UPI QR or cash, then offer to send the agreement via WhatsApp.
4. **Dues.** Filters (All, Overdue >5 days, Unpaid, Paid). Row: name, bed, amount, due date. WhatsApp reminder button, "Mark received" button that triggers a PDF receipt.
5. **Sub-meter reader.** Rooms with previous reading, enter new reading, live units and charge, optional dial photo, one-tap add to bills.
6. **Expenses and P&L.** Title, amount, category, receipt photo, month-to-date income vs expenses.
7. **Checkout.** Deposit held, less unpaid rent, less electricity, less damages (input), calculated refund, confirm vacate.

---

## 8. Code Blueprints

### 8.1 WhatsApp reminder (`utils/whatsapp.ts`)

```typescript
import { Linking, Alert } from 'react-native';

export const sendRentReminder = async (
  phone: string, name: string, bed: string, amountPaise: number, upiVpa: string
) => {
  const amount = (amountPaise / 100).toFixed(2);
  const message =
    `Hello ${name},\n\nYour rent for Bed ${bed} is ₹${amount}.\n\n` +
    `Please pay via UPI to: ${upiVpa}\n\nThank you!`;
  const url = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Error', 'Could not open WhatsApp');
  }
};
```

`wa.me` links need no `canOpenURL` check or extra iOS/Android query declarations. Attach the UPI QR image through the share sheet.

### 8.2 Dynamic UPI QR modal (`components/DynamicUpiQrModal.tsx`)

```typescript
import React from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

interface Props {
  visible: boolean; onClose: () => void;
  upiVpa: string; amountPaise: number; tenantName: string;
}

export const DynamicUpiQrModal = ({ visible, onClose, upiVpa, amountPaise, tenantName }: Props) => {
  const amount = (amountPaise / 100).toFixed(2);
  const payload =
    `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent('PG Rent')}` +
    `&am=${amount}&cu=INR&tn=${encodeURIComponent('Rent ' + tenantName)}`;
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.title}>Scan & Pay Rent</Text>
          <Text style={s.amount}>₹{amount}</Text>
          <QRCode value={payload} size={220} />
          <Text style={s.note}>Scan with GPay, PhonePe, or Paytm</Text>
          <TouchableOpacity style={s.button} onPress={onClose}>
            <Text style={s.buttonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  card: { width: 300, padding: 24, backgroundColor: '#fff', borderRadius: 16, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  amount: { fontSize: 26, fontWeight: '800', color: '#16a34a', marginBottom: 16 },
  note: { fontSize: 12, color: '#666', marginTop: 12 },
  button: { marginTop: 20, backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 32, borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
```

### 8.3 PDF receipt (`utils/pdfReceipt.ts`)

```typescript
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const generateAndShareReceipt = async (r: {
  receiptNo: string; tenantName: string; bedNo: string;
  amountPaise: number; date: string; property: string;
}) => {
  const html = `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { font-family: Helvetica, sans-serif; padding: 24px; color: #1e293b; }
      .header { text-align: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
      .badge { display: inline-block; background: #dcfce7; color: #15803d; padding: 4px 12px; border-radius: 9999px; font-weight: bold; }
      .row { display: flex; justify-content: space-between; margin: 12px 0; border-bottom: 1px dashed #cbd5e1; padding-bottom: 8px; }
      .total { font-size: 20px; font-weight: bold; }
    </style></head><body>
    <div class="header"><h2>${esc(r.property)}</h2><p>Rent Payment Receipt</p><span class="badge">PAID</span></div>
    <div style="margin-top:24px">
      <div class="row"><span>Receipt No:</span><strong>${esc(r.receiptNo)}</strong></div>
      <div class="row"><span>Date:</span><strong>${esc(r.date)}</strong></div>
      <div class="row"><span>Tenant:</span><strong>${esc(r.tenantName)}</strong></div>
      <div class="row"><span>Room & Bed:</span><strong>${esc(r.bedNo)}</strong></div>
      <div class="row total"><span>Amount Received:</span><span>₹${(r.amountPaise / 100).toFixed(2)}</span></div>
    </div>
    <p style="text-align:center;margin-top:40px;font-size:11px;color:#64748b">
      Computer generated receipt. No signature required.</p>
  </body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri);
};
```

### 8.4 Currency helper (`utils/currency.ts`)

```typescript
export const formatINR = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
```

---

## 9. 20-Week Roadmap (timeline)

| Stage | Weeks | Dates | Focus |
|---|---|---|---|
| 0 | 1 | Nov 1 – Nov 7, 2026 | Setup, wireframes, secure 5 pilots |
| 1 | 2–3 | Nov 8 – Nov 21 | Backend auth and org scoping, mobile shell, biometrics |
| 2 | 4–5 | Nov 22 – Dec 5 | Property/room/bed APIs, visual bed matrix with offline cache |
| 3 | 6–7 | Dec 6 – Dec 19 | Transactions, proration, camera KYC, quick check-in |
| 4 | 8–9 | Dec 20 – Jan 2 | Monthly invoicing, Dues tab, WhatsApp, PDF receipts |
| 5 | 10 | Jan 3 – Jan 9, 2027 | Pulse dashboard, Sentry, APK, pilot deployment |
| 5b | 11 | Jan 10 – Jan 16 | In-person onboarding and first feedback |
| 6 | 12–15 | Jan 17 – Feb 13 | Checkout, sub-meters, expenses and P&L |
| 7 | 16–17 | Feb 14 – Feb 27 | Staff roles, read-only paywall, web billing |
| 8 | 18–21 | Feb 28 – Mar 27 | Google Play closed test (14 days), compliance, TestFlight, production |

> The stage-by-stage text below uses the original week numbering (Stage 6 = weeks 11–14, Stage 7 = 15–16, Stage 8 = 17–20). The table above is the calendar-accurate version from the Gantt dates, which runs about one week longer because the pilot onboarding week sits between Stage 5 and Stage 6. Pick one and keep it consistent. Plan buffer on top of either; solo timelines usually slip.

---

## 10. Stage-by-Stage Detail

### Stage 0: Setup and pilot securing (Week 1)
**Goal:** foundation in place and 5 committed pilot users.
- Create `pg-owner-backend` and `pg-owner-mobile`.
- Configure ESLint, Prettier, `.env.example`, TypeScript strict mode.
- Provision MongoDB Atlas M0 (replica set, so transactions work).
- Wireframe the 4 tabs: Pulse, Matrix, Dues, More.
- Draft the privacy policy and KYC consent text.
- **Critical:** meet 5 local PG owners and get their commitment to pilot the Android app in exchange for a free 6-month subscription.

**Exit:** both repos push cleanly; 5 named owners locked in.

### Stage 1: Backend foundation and mobile shell (Weeks 2–3)
**Goal:** authentication and tenant scoping working on a real phone.

*Backend*
- Models: Organization, User, Subscription (stub with 14-day trial).
- Endpoints: register-owner, login, me.
- Middleware: `protect` (JWT), `enforceOrgScope` (injects `req.orgId`), rate limiting on auth routes.
- **Test:** Organization B gets a 403/404 for Organization A's resources.

*Mobile*
- Initialize Expo with NativeWind v4.
- Build `(auth)/login.tsx` and `register.tsx`.
- Store the JWT in `expo-secure-store`.
- Add biometric unlock with `expo-local-authentication`.

**Exit:** register on a physical phone, close the app, unlock with biometrics, see an authenticated screen.

### Stage 2: Property hierarchy and visual bed matrix (Weeks 4–5)
**Goal:** floors, rooms and beds rendered with offline caching.

*Backend*
- Models: Property, Room, Bed.
- Property CRUD, room creation that auto-generates beds (101-A, 101-B), and `GET /api/properties/:id/matrix`.
- All rates in integer paise.

*Mobile*
- TanStack Query with the async-storage persister.
- `matrix.tsx`: floor pills, room cards, bed chips (🟢 vacant with rent, 🔴 occupied with name, 🟡 notice, ⚪ maintenance).

**Exit:** the matrix renders; with Airplane Mode on, the layout and statuses still show without crashing.

### Stage 3: Quick check-in, KYC and proration (Weeks 6–7)
**Goal:** onboard a tenant in under 2 minutes, reliably.

*Backend*
- Models: Tenant, BedAssignment, Invoice, SecurityDeposit/DepositLedger.
- Unique index on Invoice `{ tenant, month, year }`.
- Proration utility with 10+ unit tests: 28/29/30/31-day months, leap February, joining on day 1 and on the last day.
- Single-transaction check-in:

```typescript
await runInTransaction(async (session) => {
  // 1. Create Tenant
  // 2. Mark Bed 'occupied'
  // 3. Record Security Deposit
  // 4. Generate first prorated Invoice
});
```

- KYC: private/authenticated Cloudinary asset, doc type + masked number, consent flag required.

*Mobile*
- `checkin/[bedId].tsx` opens on tapping a green bed.
- Capture with `expo-camera`, compress with `expo-image-manipulator` (under 200 KB), retry on failed upload.
- Form pre-fills base rent from the bed's room.

**Exit:** tap a green bed, snap an ID, submit → bed turns red and the prorated invoice exists.

### Stage 4: Collections, WhatsApp and receipts (Weeks 8–9)
**Goal:** monthly billing, 1-tap reminders, instant receipts.

*Backend*
- `POST /api/invoices/generate-monthly`: idempotent, secret-header protected; run it from a scheduled GitHub Action. Running it twice must create no duplicates.
- `POST /api/payments/mark-paid`: updates the balance, supports partial payments, logs the payment, generates a sequential receipt number.

*Mobile*
- `dues.tsx` with filters: Overdue (>5 days), Unpaid, Paid.
- WhatsApp button builds a `wa.me` link with name, bed, amount and the owner's UPI ID.
- UPI QR modal with `react-native-qrcode-svg`, shared as an image via the share sheet.
- "Mark received" button, then a PDF receipt via `expo-print` + `expo-sharing`.

**Exit:** send a reminder, record payment in one tap, send a PDF receipt to the tenant.

### Stage 5: Pulse dashboard and pilot deployment (Week 10)
**Goal:** put the MVP in the hands of the 5 pilot owners.
- Build `index.tsx`: collected this month, overdue total, occupancy %, overdue banner linking to Dues, floating action button.
- Set up Sentry (free tier) on backend and mobile.
- Build a direct-install Android APK (EAS preview profile or a local release build).
- Test on a low-end Android phone and a slow connection.
- Visit all 5 owners in person, install the APK, and seed their real properties and tenants.

**Exit:** all 5 pilot owners actively using it on their properties.

### Stage 6: Pilot feedback and operations expansion (Weeks 11–14)
**Goal:** build second-tier tools driven by owner requests. Let feedback reorder this list.
- **Guarded checkout and settlement:** preview pending rent, unbilled electricity and damage deductions against the deposit; `POST /api/checkouts/confirm` runs in a transaction, releases the bed and produces a settlement statement.
- **Sub-meter reader:** reading + dial photo, units × rate, split by days occupied, added as line items to the next invoice.
- **Expense ledger and live P&L:** categories, receipt photos, net cashflow = collections − expenses.
- **Notice period** status with countdown on the bed chip.
- Maintenance tickets and visitor log only if pilot owners ask for them.

**Exit:** at least 3 of 5 owners use the app weekly; the top 10 complaints are fixed.

### Stage 7: Team roles and subscription paywall (Weeks 15–16)
**Goal:** monetization and multi-staff access.
- **Staff roles:** owners invite managers/wardens/security with per-property permissions.
- **Subscription enforcement:** `enforceSubscription` checks status and plan limits (properties, beds).
- **Read-only mode:** expired accounts can view everything; mutating requests return `402 Payment Required`. Never lock owners out of their own data.
- **Billing:** start with manual UPI subscriptions and an admin toggle. Add Razorpay subscriptions and the webhook once there are 10+ paying owners. Host billing on the web (`yourapp.com/billing`); the app stays a login-only companion.

**Exit:** a trial expires, the app goes read-only, paying on the web unlocks it immediately.

### Stage 8: Store launches (Weeks 17–20)
**Goal:** live on Google Play and the App Store.
- **Week 17, Google Play closed test:** new personal accounts need 12+ testers for 14 continuous days. Enroll the 5 pilot owners plus 10 personal contacts on day one.
- **Week 18, compliance and assets:** 1024×1024 icon, splash, screenshots, privacy policy, terms, in-app account deletion.
- **Week 19, iOS TestFlight:** needs a Mac (or paid EAS cloud builds) and the $99/yr Apple Developer account.
- **Week 20, production:** promote the Play build to production; submit iOS for App Review.
- **Ops:** automated daily MongoDB backups, uptime monitoring, a staging environment.

**Exit:** the app is downloadable from Google Play (iOS may follow shortly after).

### After launch
- Hindi and regional language support.
- A hosted payment page (`/pay/:invoiceId`) or Razorpay Payment Links for auto-reconciliation.
- Full offline-first sync, CSV exports, multi-property analytics.
- Referral flow from pilot owners (your cheapest acquisition channel).

---

## 11. Weekly Non-Negotiable Checklist

1. **Integer paise.** Every model, query and calculation uses paise; format to ₹ only at the presentation layer.
2. **Tenant scoping.** Every query includes `{ organization: req.orgId }`.
3. **Test the money logic.** Proration, electricity split and settlement each need unit tests.
4. **Pilot check-in.** A 15-minute call with pilot owners every week; track which screens they actually use.
5. **Scope discipline.** If you fall behind, cut optional features (visitor logs, themes) before delaying the pilot.
6. **Ship every 1–2 weeks** to real users.

---

## 12. Risks to Watch

- **Acquisition, not code, is the main risk.** Pilot owners and referrals matter more than extra features.
- **KYC data is sensitive.** Aadhaar handling is restricted in India (DPDP Act, UIDAI rules): use private storage, get consent, store masked numbers where possible, and offer deletion.
- **Manual UPI confirmation** means owners must reconcile payments themselves; make "Mark received" fast and add an audit trail.
- **Store policies** on subscriptions change; re-check before Stage 7.
- **Competitor claims** (fees, check-in times) in marketing material should be verified before publishing.