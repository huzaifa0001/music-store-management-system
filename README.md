# Music Store Decoupled SPA

This project has a Node/Express REST API plus a routed AngularJS frontend for role-based admin, employee, and customer flows.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Demo Logins

| Role | Username | Password |
| --- | --- | --- |
| Admin | `admin` | `admin123` |
| Employee | `employee` | `employee123` |
| Customer | `customer` | `customer123` |

## What Was Added

- REST API for auth, products, dashboard stats, sales, and checkout.
- JWT authentication with role-based route protection.
- Admin/employee routes for dashboard, inventory, and sales.
- Complete customer journey: home, product catalogue, product detail, cart, checkout, confirmation, and account pages.
- Vinyl-style audio preview player with playback-synchronized animation.
- Cart persistence through `localStorage`.
- Automatic stock decrementing when an admin records a sale or a customer checks out.
- Normalized records for customers, orders, order items, sales, inventory logs, and employee activity logs.
- Low-stock alerts on the dashboard and inventory views.
- Animated dashboard charts, real-time metrics, interactive tables, and modern card layouts.
- jQuery-powered slide-down invoice details on the admin sales page.
- Stripe test-mode support when `STRIPE_SECRET_KEY` is configured.
- PDF receipt generation for every confirmed order.
- Optional receipt email automation when SMTP environment variables are configured.

## Optional Environment Variables

```bash
JWT_SECRET=replace-this-in-production
STRIPE_SECRET_KEY=sk_test_...
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user
SMTP_PASS=password
SMTP_SECURE=false
RECEIPT_FROM=receipts@example.com
```

If SMTP is not configured, receipts are still generated locally under `data/receipts/`.

## Notes

The user records in `data/db.json` currently use plain-text demo passwords so the app is easy to run for coursework review. For production, hash passwords with `bcryptjs`, store data in a real database, and enforce HTTPS-only token storage policies.
