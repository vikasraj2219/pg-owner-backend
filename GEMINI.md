# Project Rules & Guidelines

## 🔐 Workspace, File & Command Execution Permissions
* The agent has permanent, full access to all PG Owner project files across both backend (`pg-owner-backend`) and mobile (`pg-owner-mobile`).
* The agent has full access to perform all Git operations (commit, branch, push, stash, checkout, rebase) across both repositories.
* Never ask the user for file access permissions, directory read/write permissions, or Git command confirmations for both `pg-owner-backend` and `pg-owner-mobile`—execute all necessary file reads, file edits, directory traversals, build commands, and Git operations directly, seamlessly, and autonomously.

## 💰 Core Architecture Principles
* **Integer Paise Everywhere**: Every monetary value (`rentPaise`, `depositPaise`, `balancePaise`, `subtotalPaise`, `totalPaise`) is calculated and stored strictly in integer paise (100 paise = ₹1.00). Format to ₹ with currency helpers only at presentation/UI layers.
* **Strict Tenant Scoping**: Every query, mutation, and aggregation must be strictly scoped by organization (`organization: req.orgId`).
* **Compliance & Privacy**: Aadhaar numbers must be masked (`XXXX-XXXX-1234`) storing only the last 4 digits, and DPDP Act 2023 tenant consent is strictly required for check-in.

