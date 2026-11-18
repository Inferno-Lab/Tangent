# Texts, emails or payments stop going through

## See what is failing

- Console → Integrations → Activity: each message with its status and the provider's reason. Filter by school or by
  "failed".
- Console → Health: the connection's last test and the error list.
- The provider's own status page (linked from the connection's setup steps).

## Switch to another provider

1. **A fallback that is already live.** Console → Integrations → Routing → the capability (Text messages, Email…) →
   set the fallback to another live connection. Messages that fail on the main one are sent through the fallback.
2. **No second provider yet.** Integrations → Add a connection → the capability → choose the provider (a school's country
   suggests its usual ones first) → follow its steps → Save → Test → Take live (a second person approves) → Routing.
   A connection still in draft cannot be routed.
3. Failed messages are retried by the dispatcher; urgent ones (sign-in codes) go at once on the new route.

## Payments

Online payment links already sent keep their provider. While a payment provider is down, families pay at the school's
office (the office records it as cash, card or bank transfer). Reconciliation (Fees → Online payments) shows any payment
the provider took but the school did not receipt; the office refunds or receipts it.

## After

Switch the route back when the provider recovers, or keep the new one. Note in the connection what happened.
