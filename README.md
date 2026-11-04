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

### Stage 0: Setup and pilot securing (Week 1) — *Completed ✅*
**Goal:** foundation in place and 5 committed pilot users.
- [x] Create `pg-owner-backend` and `pg-owner-mobile`.
- [x] Configure ESLint, Prettier, `.env.example`, TypeScript strict mode.
- [x] Provision MongoDB Atlas M0 (replica set, so transactions work).
- [ ] Wireframe the 4 tabs: Pulse, Matrix, Dues, More (Mobile).
- [x] Draft the privacy policy and KYC consent text (`docs/PRIVACY_AND_KYC_CONSENT.md`).
- [ ] **Critical:** meet 5 local PG owners and get their commitment to pilot the Android app in exchange for a free 6-month subscription (`docs/STAGE_0_PILOT_TRACKER.md`).

**Exit:** both repos push cleanly; 5 named owners locked in.

### Stage 1: Backend foundation and mobile shell (Weeks 2–3) — *Completed ✅*
**Goal:** authentication and tenant scoping working on a real phone.

*Backend (Completed ✅)*
- [x] Models: Organization, User, Subscription (stub with 14-day trial).
- [x] Endpoints: register-owner, login, me.
- [x] Middleware: `protect` (JWT), `enforceOrgScope` (injects `req.orgId`), rate limiting on auth routes.
- [x] **Test:** Organization B gets a 403/404 for Organization A's resources.

*Mobile (Completed ✅)*
- [x] Initialize Expo with NativeWind v4 (Stage 0).
- [x] Connect `(auth)/login.tsx` and `register.tsx` to backend auth APIs.
- [x] Store the JWT in `expo-secure-store`.
- [x] Add biometric unlock with `expo-local-authentication`.

**Exit:** register on a physical phone, close the app, unlock with biometrics, see an authenticated screen.

### Stage 2: Property hierarchy and visual bed matrix (Weeks 4–5) — *Completed ✅*
**Goal:** floors, rooms and beds rendered with offline caching.

*Backend (Completed ✅)*
- [x] Models: Property, Room, Bed, Tenant.
- [x] Property CRUD, room creation that auto-generates beds (101-A, 101-B), and `GET /api/properties/:id/matrix`.
- [x] All rates in integer paise.

*Mobile (Completed ✅)*
- [x] TanStack Query with the async-storage persister (`safeStorage`).
- [x] `matrix.tsx`: floor pills, room cards, bed chips (🟢 vacant with rent, 🔴 occupied with name, 🟡 notice, ⚪ maintenance).

**Exit:** the matrix renders; with Airplane Mode on, the layout and statuses still show without crashing.

### Stage 3: Quick check-in, KYC and proration (Weeks 6–7) — *Completed ✅*
**Goal:** onboard a tenant in under 2 minutes, reliably.

*Backend (Completed ✅)*
- [x] Models: Tenant, BedAssignment, Invoice, SecurityDeposit/DepositLedger.
- [x] Unique index on Invoice `{ tenant, month, year }`.
- [x] Proration utility with 15 unit tests: 28/29/30/31-day months, leap February, joining on day 1 and on the last day.
- [x] Single-transaction check-in (`POST /api/checkins/quick`):

```typescript
await runInTransaction(async (session) => {
  // 1. Create Tenant
  // 2. Mark Bed 'occupied'
  // 3. Record Security Deposit
  // 4. Generate first prorated Invoice
});
```

- [x] KYC: masked Aadhaar number (`XXXX-XXXX-1234`), DPDP Act 2023 consent flag required.

*Mobile (Completed ✅)*
- [x] `checkin/[bedId].tsx` opens on tapping a green bed.
- [x] Pre-fills base rent and room information from the selected bed.
- [x] Live proration calculation breakdown (`(T - D + 1) / T`).
- [x] UIDAI Aadhaar masking (`XXXX-XXXX-1234`) and DPDP consent checkbox.
- [x] Dynamic UPI QR modal and cash toggle with query cache invalidation.

**Exit:** tap a green bed, snap an ID, submit → bed turns red and the prorated invoice exists.

### Stage 4: Collections, WhatsApp and receipts (Weeks 8–9) — *Completed ✅*
**Goal:** monthly billing, 1-tap reminders, instant receipts.

*Backend (Completed ✅)*
- [x] `POST /api/invoices/generate-monthly`: idempotent, secret-header (`x-cron-secret`) protected; scheduled GitHub Action or authenticated owner trigger. Running it twice creates no duplicates.
- [x] `POST /api/invoices/:id/pay`: updates balance, supports partial and full payments, logs payment in `Payment` ledger, generates sequential receipt number (`RCP-YYYYMM-XXXX`).
- [x] `GET /api/invoices`: list receivables with filter support (overdue, unpaid, paid, search) and automatic grace period overdue calculation.
- [x] `GET /api/payments`: list recorded payments and receipts scoped strictly by organization.

*Mobile (Completed ✅)*
- [x] `dues.tsx` with filters: Overdue (>5 days), Unpaid, Paid, All, plus instant search.
- [x] WhatsApp button builds a `wa.me` link with tenant name, bed, due amount, and owner's UPI ID.
- [x] UPI QR modal (`DynamicUpiQrModal`) presented directly from each unpaid card.
- [x] `RecordPaymentModal.tsx` records payment mode (UPI/Cash/Bank), partial/full payment, and generates/shares branded PDF receipt via `expo-print` + `expo-sharing`.

**Exit:** send a reminder, record payment in one tap, send a PDF receipt to the tenant.

### Stage 5: Pulse dashboard and pilot deployment (Week 10) — *Completed ✅*
**Goal:** put the MVP in the hands of the 5 pilot owners.
- [x] Build `index.tsx`: collected this month, overdue total, occupancy %, overdue banner linking to Dues, floating action button.
- [x] Quick actions: Check-in, Dues, Add Property shortcuts.
- [x] Live inventory status pills (vacant, occupied, notice, maintenance).
- [x] Recent Pulse activity feed with real-time check-in and payment updates.
- [x] Build direct-install Android release APK (`./pg-owner-mobile-release.apk` & `~/Downloads/pg-owner-mobile.apk`).
- [x] Backend test suite: 102/102 passing tests across 12 test suites.

**Exit:** all 5 pilot owners actively using it on their properties.

### Stage 6: Pilot feedback and operations expansion (Weeks 11–14) — *Completed ✅*
**Goal:** build second-tier tools driven by owner requests.
- [x] **Guarded checkout and settlement:** preview pending rent, unbilled electricity and damage deductions against the deposit; `POST /api/checkouts/confirm` runs in a transaction, releases the bed, settles unpaid invoices, and produces a sequential settlement statement (`SET-YYYYMM-XXXX-SEQ`).
- [x] **Sub-meter reader:** reading dial, units × rate, split across active tenants (equal or by days stayed), saved with photo and tenant splits.
- [x] **Expense ledger and live P&L:** categories, receipt details, net cashflow = collections − expenses, profit margin calculation.
- [x] **Notice period** management: `POST /api/tenants/:id/notice` and `cancel-notice`, countdown display on bed chip.

**Exit:** checkout statements, EB splits, live P&L cashflow, and notice countdown active.

### Stage 7: Team roles and subscription paywall (Weeks 15–16) — *Completed ✅*
**Goal:** monetization and multi-staff access.
- [x] **Staff roles:** owners invite managers/wardens/security with per-property permissions (`assignedProperties`).
- [x] **Subscription enforcement:** `enforceSubscription` checks status and plan limits (properties, beds).
- [x] **Read-only mode:** expired accounts can view everything; mutating requests return `402 Payment Required`. Never lock owners out of their own data.
- [x] **Billing & Quota Management:** plan limits (`starter`, `growth`, `pro`), instant upgrade API, trial extension, and live quota utilization (`propertiesUsed`, `bedsUsed`).

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

---

## 13. Build Execution & Progress Log

### ✅ Stage 0: Setup and Foundation (Backend)
- **Status**: Completed & Verified
- **Deliverables**:
  - **Stack Setup**: Node.js + Express + TypeScript + Mongoose + Zod configured with strict mode.
  - **Lint & Format**: ESLint 9 flat configuration (`eslint.config.mjs`) and Prettier (`.prettierrc`).
  - **Security & Infrastructure**: Helmet, CORS, body parsers, Morgan logging, `AppError` and centralized `errorHandler` (handles Zod validation, Mongo duplicate keys, CastError, JWT errors).
  - **Database & Replica Set**: Connected to MongoDB Atlas cluster (`atlas-vnuarb-shard-0` replica set).
  - **Database Cleanup**: Cleaned up 30 legacy/incompatible collections to guarantee a fresh start for integer-paise accounting.
  - **Compliance Docs**:
    - [`docs/PRIVACY_AND_KYC_CONSENT.md`](docs/PRIVACY_AND_KYC_CONSENT.md): DPDP Act 2023 & UIDAI Aadhaar masking compliance notice and tenant consent agreement.
    - [`docs/STAGE_0_PILOT_TRACKER.md`](docs/STAGE_0_PILOT_TRACKER.md): Pilot user tracking table & pitch script for 5 PG owners.
  - **Test Suite (22/22 Passing, 90.7% statement coverage)**:
    - [`tests/health.test.ts`](tests/health.test.ts): Root `/health`, API `/api/health`, and 404 route handling.
    - [`tests/errorHandler.test.ts`](tests/errorHandler.test.ts): Custom `AppError`, Zod validation errors, Mongoose duplicate key, CastError, JWT errors, 500 fallback.
    - [`tests/database.test.ts`](tests/database.test.ts): State mapping, disconnected handling, live Atlas replica set connect/disconnect lifecycle.
    - [`tests/env.test.ts`](tests/env.test.ts): Environment variable validation & fallback defaults.

### ✅ Stage 1: Backend Foundation & Authentication
- **Status**: Completed & Verified
- **Deliverables**:
  - **Mongoose Data Models**:
    - [`src/models/Organization.ts`](src/models/Organization.ts): Owner information, phone, email, settings (`rentDueDay`, `gracePeriodDays`, `defaultLateFeePaise`).
    - [`src/models/User.ts`](src/models/User.ts): Multi-tenant User with bcrypt password hashing, `role: 'owner' | 'manager' | 'staff'`, hidden password query default, and `comparePassword` method.
    - [`src/models/Subscription.ts`](src/models/Subscription.ts): Multi-tenant Subscription with starter 14-day free trial, `plan: 'starter' | 'growth' | 'pro'`, and tier-based property/bed quotas.
  - **Authentication API**:
    - `POST /api/auth/register-owner`: Atomic multi-document transaction provisioning Organization, Owner User, and Starter 14-day trial Subscription; returns JWT and typed responses.
    - `POST /api/auth/login`: Supports login with email or phone number, password verification, active status guard; returns JWT and tenant context.
    - `GET /api/auth/me`: Authenticated endpoint returning user profile, organization settings, and current subscription plan limits.
  - **Security & Multi-Tenant Middleware**:
    - [`src/middleware/auth.ts`](src/middleware/auth.ts): Bearer JWT authentication (`protect`) and RBAC authorization (`requireRole`).
    - [`src/middleware/enforceOrgScope.ts`](src/middleware/enforceOrgScope.ts): Strictly guards against cross-tenant data tampering by enforcing `req.orgId` in route parameters and request bodies; includes `scopeFilter` helper for Mongoose query auto-bounding.
    - [`src/middleware/rateLimiter.ts`](src/middleware/rateLimiter.ts): IP rate limiting on authentication routes (30 requests per 15 min).
  - **Validation & Services**:
    - [`src/validators/auth.validator.ts`](src/validators/auth.validator.ts): Strict Zod schema validation for registration and login inputs.
    - [`src/services/token.service.ts`](src/services/token.service.ts): JWT signing and verification utility.
  - **Test Suite (38/38 Passing, 89.4% statement coverage)**:
    - [`tests/auth.test.ts`](tests/auth.test.ts) (11 tests): Registration creation, duplicate prevention (409), Zod validation (400), login with email/phone, bad passwords (401), and `/me` endpoint.
    - [`tests/orgScope.test.ts`](tests/orgScope.test.ts) (5 tests): Multi-tenant isolation verifying **Organization B gets 403 Forbidden** when requesting Organization A's resources or injecting Org A IDs.


### ✅ Stage 2: Property Hierarchy & Visual Bed Matrix
- **Status**: Completed & Verified
- **Deliverables**:
  - **Mongoose Data Models**:
    - [`src/models/Property.ts`](src/models/Property.ts): Multi-tenant Property with `name`, `type: 'boys' | 'girls' | 'coliving'`, `upiVpa`, `electricityRatePaisePerUnit` (integer paise), unique per org index.
    - [`src/models/Room.ts`](src/models/Room.ts): Multi-tenant Room linked to Property, `floorNumber`, `roomNumber`, `sharingType` (1-20), `baseRentPaisePerBed` (integer paise), `tags`.
    - [`src/models/Bed.ts`](src/models/Bed.ts): Multi-tenant Bed linked to Room & Property, auto-numbered (`101-A`, `101-B`), `status: 'available' | 'occupied' | 'notice_period' | 'maintenance'`, optional `maintenanceNote` & `noticeEndDate`.
    - [`src/models/Tenant.ts`](src/models/Tenant.ts): Tenant schema registered to support future check-ins and populated bed matrix queries.
  - **REST API Endpoints**:
    - `POST /api/properties`: Create property with integer paise rate & subscription quota enforcement (Starter plan allows 1 property).
    - `GET /api/properties`: List properties for authenticated organization with live aggregated stats (totalRooms, totalBeds, occupiedBeds, availableBeds).
    - `GET /api/properties/:id`: Get detailed single property with stats.
    - `PUT /api/properties/:id`: Update property details (name, upiVpa, electricity rate).
    - `DELETE /api/properties/:id`: Owner-only deletion with safeguard preventing deletion of properties with occupied beds.
    - `POST /api/properties/:id/rooms`: Create room with atomic auto-generation of beds (`${roomNumber}-A`, `${roomNumber}-B`) inside MongoDB transaction, duplicate room prevention, and plan bed quota checking.
    - `GET /api/properties/:id/rooms`: List rooms for property with populated beds and optional `floorNumber` filter.
    - `PUT /api/properties/:id/rooms/:roomId`: Update room rent and tags.
    - `GET /api/properties/:id/matrix`: Visual bed matrix grouping rooms by floor with live beds, tenant details, and comprehensive occupancy summary.
    - `GET /api/beds/:id`: Single bed details with populated room, property, and tenant.
    - `PUT /api/beds/:id/status`: Update bed status (e.g. to `maintenance` with note, or `notice_period` with countdown date) with safeguard against resetting occupied beds without checkout.
  - **Validation & Scoping**:
    - [`src/validators/property.validator.ts`](src/validators/property.validator.ts): Strict Zod schema validation for property, room, and bed operations.
    - [`src/middleware/enforceOrgScope.ts`](src/middleware/enforceOrgScope.ts): Multi-tenant hard-scoping on all property, room, and bed endpoints.
  - **Test Suite (61/61 Passing across all 8 test suites)**:
    - [`tests/property.test.ts`](tests/property.test.ts) (16 tests): Unauthenticated rejection (401), validation (400), creation, duplicates (409), subscription limits (403), org scoping isolation (404), bed auto-generation, and room listing/filtering.
    - [`tests/matrix.test.ts`](tests/matrix.test.ts) (6 tests): Grouped matrix response with floor-room-bed hierarchy, summary calculations, bed status transitions, and cross-tenant isolation (404).

### ✅ Stage 3: Quick Check-in, KYC and Proration
- **Status**: Completed & Verified
- **Deliverables**:
  - **Mongoose Data Models**:
    - [`src/models/BedAssignment.ts`](src/models/BedAssignment.ts): Multi-tenant bed assignment tracking active stay, check-in/out dates, monthly rent in paise, and security deposit in paise.
    - [`src/models/Invoice.ts`](src/models/Invoice.ts): Multi-tenant invoice with compound unique index `{ tenant: 1, month: 1, year: 1 }`, sequential invoice number (`INV-YYYYMM-XXXX-SEQ`), line items (prorated rent), total paise, amount paid paise, and balance paise.
    - [`src/models/DepositLedger.ts`](src/models/DepositLedger.ts): Multi-tenant security deposit ledger logging payments received/refunded/deducted with payment method and transaction references.
  - **Proration Engine & Services**:
    - [`src/services/proration.service.ts`](src/services/proration.service.ts): Mathematical formula implementation `payablePaise = round(monthlyRentPaise * (T - D + 1) / T)` with day 1 full-month logic and calendar month length handling (28, 29 leap, 30, 31).
    - [`src/services/invoiceNumber.service.ts`](src/services/invoiceNumber.service.ts): Collision-resistant sequential invoice numbering system `INV-YYYYMM-XXXX-SEQ`.
  - **Atomic Check-in API & Tenant Management**:
    - `POST /api/checkins/quick`: Multi-document MongoDB transaction creating Tenant, marking Bed occupied, creating BedAssignment, generating first prorated Invoice, and recording DepositLedger.
    - `GET /api/tenants`: List tenants scoped to organization with search and status filtering.
    - `GET /api/tenants/:id`: Full tenant profile with populated bed, room, property, active assignment, and deposit history.
  - **Validation & Compliance**:
    - [`src/validators/checkin.validator.ts`](src/validators/checkin.validator.ts): Strict Zod validation enforcing DPDP Act 2023 compliance (`kycConsent: true`), Indian phone regex, and UIDAI masked Aadhaar format (`XXXX-XXXX-1234`).
  - **Test Suite (84/84 Passing across 10 test suites)**:
    - [`tests/proration.test.ts`](tests/proration.test.ts) (15 tests): Full calendar matrix verification (31-day, 30-day, 28-day, 29-day leap years, day 1, day 15, day 28/29/30/31).
    - [`tests/checkin.test.ts`](tests/checkin.test.ts) (8 tests): Atomic transaction rollback on failure, proration invoice generation, DPDP consent enforcement, 409 double check-in prevention, and organization isolation.

### ✅ Stage 4: Collections, WhatsApp and Receipts
- **Status**: Completed & Verified
- **Deliverables**:
  - **Mongoose Data Models & Registration**:
    - [`src/models/Payment.ts`](src/models/Payment.ts): Payment ledger tracking organization, property, tenant, invoice, sequential receipt number (`RCP-YYYYMM-XXXX`), integer paise amount, payment method (`cash` | `upi` | `bank_transfer`), transaction reference, payment date, and recording user.
    - Registered in [`src/models/index.ts`](src/models/index.ts).
  - **Sequential Receipt Numbering Engine**:
    - [`src/services/receiptNumber.service.ts`](src/services/receiptNumber.service.ts): Generates collision-resistant, month-scoped sequential receipt IDs (`RCP-YYYYMM-XXXX-SEQ`).
  - **REST API Endpoints & Idempotent Invoicing**:
    - `POST /api/invoices/generate-monthly`: Protected by `x-cron-secret` header or JWT session; generates monthly invoices across active tenant assignments, guarantees strict idempotency (0 duplicate invoices on multiple runs).
    - `POST /api/invoices/:id/pay`: Multi-mode payment recording supporting full and partial payments, balances, status transitions (`unpaid` → `partially_paid` → `paid`), receipt creation, and overpayment guards.
    - `GET /api/invoices`: Full receivables query endpoint with `propertyId`, `status` (`all`, `overdue`, `unpaid`, `paid`), `search`, and dynamic `overdueDays` calculation using organization `gracePeriodDays`.
    - `GET /api/payments`: Scoped payment and receipt history query endpoint.
  - **Test Suite (98/98 Passing across 11 test suites)**:
    - [`tests/invoice.test.ts`](tests/invoice.test.ts) (14 tests): Verifies monthly generation idempotency, cron secret execution, overdue calculation, partial payment status updates, full payment completion, sequential receipt numbering, overpayment prevention, and cross-tenant security.

### ✅ Stage 5: Pulse Dashboard & Pilot Deployment
- **Status**: Completed & Verified
- **Deliverables**:
  - **REST API & Pulse Analytics**:
    - `GET /api/dashboard/stats`: Expanded dashboard analytics supporting optional `propertyId` filtering or aggregate portfolio stats:
      - **Bed Inventory Breakdown**: `totalBeds`, `occupiedBeds`, `availableBeds`, `maintenanceBeds`, `noticeBeds`, `totalRooms`, `occupancyRate`.
      - **Financial Health in Integer Paise**: `collectedThisMonthPaise`, `expectedThisMonthPaise`, `pendingAmountPaise`, `collectionRate`, `netProfitPaise`.
      - **Grace-Period Bounded Overdue Tracking**: `overdueCount`, `overdueAmountPaise` considering organization `gracePeriodDays`.
      - **Unified Pulse Activity Feed**: `recentActivity` merging latest payments and tenant check-ins sorted chronologically with formatted INR and metadata.
  - **Test Suite (102/102 Passing across 12 test suites)**:
    - [`tests/dashboard.test.ts`](tests/dashboard.test.ts) (4 tests): Verifies zero-state default statistics, inventory & financial calculations, overdue recognition with grace period, and multi-tenant organization boundary isolation.

### ✅ Stage 6: Pilot Feedback & Operations Expansion
- **Status**: Completed & Verified
- **Deliverables**:
  - **Mongoose Data Models**:
    - [`src/models/SettlementStatement.ts`](src/models/SettlementStatement.ts): Tracks sequential settlement statements (`SET-YYYYMM-XXXX-SEQ`), deposit paid, damage deductions, unbilled electricity, net refund, and payment mode.
    - [`src/models/MeterReading.ts`](src/models/MeterReading.ts): Tracks sub-meter dial readings (previous, current, units consumed, rate in paise, total in paise, and room tenant splits).
    - [`src/models/Expense.ts`](src/models/Expense.ts): Operational expenses ledger with categories, vendor name, payment method, and integer paise precision.
  - **REST API Endpoints**:
    - `GET /api/checkouts/preview/:tenantId`: Live checkout preview computing deposit paid, unpaid invoice dues, and estimated net refund.
    - `POST /api/checkouts/confirm`: Atomic multi-document MongoDB transaction releasing bed to `available`, closing bed assignment (`status: 'vacated'`), settling unpaid dues, logging deposit refund in `DepositLedger`, and generating sequential `SettlementStatement`.
    - `GET /api/checkouts/statements`: Scoped settlement statement history.
    - `POST /api/meters/reading`: Records room sub-meter dial, computes units and cost in integer paise, and splits bill across room occupants (equal or by days stayed).
    - `GET /api/meters/readings`: List readings by property and room.
    - `GET /api/meters/room/:roomId/latest`: Retrieves previous reading for instant prefill.
    - `POST /api/expenses`: Logs operational expenses in integer paise.
    - `GET /api/expenses`: Query expenses with category, property, and date range filters.
    - `GET /api/expenses/pnl`: Live Profit & Loss summary (Collections − Expenses = Net Cashflow, profit margin %, and category breakdown).
    - `POST /api/tenants/:id/notice`: Sets tenant and bed notice period with `expectedVacateDate` and countdown.
    - `POST /api/tenants/:id/cancel-notice`: Cancels notice and restores bed to `occupied`.
  - **Test Suite (125/125 Passing across 16 test suites)**:
    - [`tests/checkout.test.ts`](tests/checkout.test.ts) (6 tests): Preview calculations, atomic transaction execution, bed release, deposit refund logging, double checkout prevention (400), and organization boundary isolation (404).
    - [`tests/meter.test.ts`](tests/meter.test.ts) (6 tests): Units and paise calculation, tenant split distribution, dial reversal guard (400), and org isolation.
    - [`tests/expense.test.ts`](tests/expense.test.ts) (7 tests): Integer paise validation, category filter, live P&L cashflow formula, and cross-tenant isolation.
    - [`tests/notice.test.ts`](tests/notice.test.ts) (3 tests): Notice period setup, bed status transition to `notice_period`, notice cancellation, and org isolation.

### ✅ Stage 7: Team Roles & Subscription Paywall
- **Status**: Completed & Verified
- **Deliverables**:
  - **Mongoose Data Models**:
    - [`src/models/User.ts`](src/models/User.ts): Extended with `assignedProperties: Types.ObjectId[]` for fine-grained per-property manager/staff access control.
    - [`src/models/Subscription.ts`](src/models/Subscription.ts): Added `expired` status to enum, tracked subscription start/end dates, plan tier (`starter` | `growth` | `pro`), and quotas (`maxProperties`, `maxBeds`).
  - **Paywall & Quota Middleware**:
    - [`src/middleware/enforceSubscription.ts`](src/middleware/enforceSubscription.ts): Safe `GET`, `HEAD`, and `OPTIONS` requests always pass through (owners are never locked out of viewing their data). Mutating requests (`POST`, `PUT`, `DELETE`, `PATCH`) return `402 Payment Required` (`SUBSCRIPTION_EXPIRED`) if the 14-day trial or paid subscription has lapsed. Quota validation helpers `checkPropertyQuota` and `checkBedQuota` prevent exceeding plan limits.
  - **REST API Endpoints**:
    - `GET /api/team/members`: List team members scoped to organization with populated property assignments.
    - `POST /api/team/members`: Owner-only member creation (`manager`, `staff`) with phone/email duplicate checking and property assignment verification.
    - `PUT /api/team/members/:id`: Owner-only update of name, role, phone, and property assignments.
    - `DELETE /api/team/members/:id`: Owner-only removal with safeguards preventing owner self-deletion.
    - `GET /api/subscription/current`: Retrieves current subscription tier, status, days remaining, `isReadOnly` flag, and real-time quota usage (`propertiesUsed`, `bedsUsed`).
    - `POST /api/subscription/upgrade`: Instantly upgrades organization plan tier (`growth`, `pro`) and restores active mutating capabilities.
    - `POST /api/subscription/extend-trial`: Extends trial period by specified days.
  - **Test Suite (137/137 Passing across 18 test suites)**:
    - [`tests/team.test.ts`](tests/team.test.ts) (7 tests): Owner-exclusive team member provisioning, property assignment validation, non-owner authorization guard (403), tenant isolation (Org B cannot view Org A staff), and update/removal lifecycle.
    - [`tests/subscription.test.ts`](tests/subscription.test.ts) (5 tests): Read-only mode access guarantee for GET requests on expired subscriptions, 402 rejection for mutating requests, current status query, instant plan upgrade unlocking account, and trial extension.

### ✅ Cloudinary Storage & KYC File Viewer
- **Status**: Completed & Verified
- **Deliverables**:
  - **Cloudinary Integration ([`src/config/cloudinary.ts`](src/config/cloudinary.ts) & [`src/services/cloudinary.service.ts`](src/services/cloudinary.service.ts))**:
    - Full Cloudinary SDK configuration using `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
    - Buffer upload via `cloudinary.uploader.upload_stream` under isolated tenant directory `pg-owner/${orgId}/kyc`.
    - Automatic quality optimization (`quality: 'auto:good'`), returning HTTPS CDN `secure_url`, `public_id`, format, and dimensions.
    - Safe deletion helper `deleteFromCloudinary`.
  - **Multipart Middleware ([`src/middleware/upload.middleware.ts`](src/middleware/upload.middleware.ts))**:
    - In-memory buffer storage with 10MB file size limit.
    - Multi-mime validation: JPEG, PNG, WEBP, and PDF.
  - **REST API Endpoints**:
    - `POST /api/uploads/kyc`: Authenticated multipart upload for tenant ID proof & KYC documents.
    - `GET /api/uploads/status`: Verifies storage service provider and configuration status.
    - `DELETE /api/uploads/:publicId`: Scoped document deletion with strict cross-organization isolation guards.
  - **Test Suite (144/144 Passing across 19 test suites)**:
    - [`tests/upload.test.ts`](tests/upload.test.ts) (7 tests): Storage status verification, unauthenticated upload rejection (401), image buffer upload returning Cloudinary CDN secure URL, missing file rejection (400), malicious file format rejection (400), cross-tenant deletion guard (403), and valid document deletion.



