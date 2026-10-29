# Privacy Policy & Tenant KYC Consent Notice

*Drafted for PG Owner Mobile Application & Backend (Stage 0)*  
*Compliance Reference: Digital Personal Data Protection (DPDP) Act, 2023 & UIDAI Aadhaar Regulations*

---

## 1. Overview & Data Fiduciary Notice

The **PG Owner Application** ("the Application", "we", "us") provides Paying Guest (PG) and hostel proprietors ("Proprietor / Property Manager") with tools to manage properties, rooms, beds, billing, and tenant onboarding.

Under Indian data protection laws, the PG Proprietor acts as the **Data Fiduciary**, and the tenant whose details are recorded acts as the **Data Principal**. The Application operates as a secure **Data Processor** providing technological infrastructure.

---

## 2. Information Collected During Tenant Onboarding

During the Quick Check-in and KYC onboarding workflow, the following information is gathered:

1. **Identity & Contact Details**:
   - Full legal name
   - Mobile phone number (for WhatsApp rent invoices, receipts, and urgent communication)
   - Emergency contact name & phone number
2. **Room & Financial Allocation**:
   - Property, room number, and bed identifier
   - Monthly rent (recorded strictly in integer paise)
   - Security deposit amount and payment record
3. **Government KYC Document**:
   - Document type selected: Aadhaar, PAN, Passport, or Voter ID.
   - **Aadhaar Masking Rule (Mandatory)**: In strict compliance with UIDAI regulations, full 12-digit Aadhaar numbers are **never stored**. Only the last 4 digits (`XXXXXXXX1234`) are retained for verification indexation.
   - Photograph / scan of the document: Uploaded directly to secure, authenticated cloud storage with access restricted strictly to the verified property owner.

---

## 3. Purpose of Collection

Tenant data is collected and processed solely for:
- Tenant onboarding and room/bed assignment.
- Police tenant verification compliance mandated by local municipal and police authorities.
- Generating monthly rent invoices, utility bills, and payment receipts.
- Emergency reach-out to nominated contacts.
- Checkout settlement and security deposit reconciliation.

Data will **never** be sold, rented, or shared with third-party advertising brokers.

---

## 4. Tenant KYC Consent Agreement Text (Presented at Check-in)

The following declaration must be accepted by the tenant (digitally acknowledged or signed via WhatsApp onboarding confirmation) prior to check-in completion:

```text
TENANT DECLARATION & KYC CONSENT

I, [Tenant Full Name], residing at [Property Name, Room/Bed No], hereby declare that:

1. The personal information, contact numbers, and identification document submitted by me 
   for tenant onboarding at [Property Name] are genuine, correct, and up-to-date.
2. I hereby grant my voluntary consent to the property management to collect, store, and 
   process my details and masked KYC document solely for tenancy management, payment records, 
   and local police verification requirements as mandated by law.
3. I understand that my document image is stored in encrypted, access-restricted cloud storage 
   and that my Aadhaar number (if submitted) is masked so that only the last 4 digits are recorded.
4. I acknowledge that rent invoices, payment receipts, and property notices will be delivered 
   to my registered mobile number via SMS or WhatsApp.

[x] I have read, understood, and agree to the above terms.
```

---

## 5. Security & Technical Safeguards

1. **Multi-Tenant Isolation**:
   Every database query is scoped strictly by `organizationId`. One PG owner cannot access or query tenants belonging to another organization.
2. **Private Document Storage**:
   KYC uploads are stored in private/authenticated Cloudinary or S3 buckets with time-limited signed URLs, inaccessible to public web scrapers.
3. **Integer-Paise Financial Precision**:
   All rent, utilities, deposits, and refunds are stored in integer paise (`₹1 = 100 paise`), preventing floating-point rounding disputes during settlement.
4. **Data Retention & Right to Erasure**:
   Upon tenant checkout and full settlement (`status: 'checked_out'`), records are archived for legal compliance (minimum required statutory audit period) and can be permanently deleted upon verified owner request.

