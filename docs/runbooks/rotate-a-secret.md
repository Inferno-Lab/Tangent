# Rotate a secret

## A provider's key (SMS, WhatsApp, email, payments, storage, maps)

1. Make a new key at the provider (its page is named in the console's setup steps for that connection).
2. Console → Integrations → the connection → type the new key → Save. A live connection whose keys change goes back to
   **test**: press Test, then **Take live**, which a second person approves.
3. Delete the old key at the provider once messages or payments are going through on the new one (Integrations →
   Activity shows each send).

## Signing tokens (`JWT_SECRET`)

Sessions are signed with `JWT_SECRET`. To change it without signing everyone out:

1. Set `JWT_SECRET_PREVIOUS` to the current value and `JWT_SECRET` to a new random value (at least 32 characters) on
   every API server (Render → the service → Environment), then deploy.
2. Tokens signed with the old secret keep working until they expire (minutes); new ones use the new secret.
3. After a day, remove `JWT_SECRET_PREVIOUS` and deploy again.

If the secret leaked, skip step 1's `JWT_SECRET_PREVIOUS`: everyone signs in again, which is the point.

## A school's staff or family password

The person uses "Forgot password" (a code to their phone or email). The school's admin can also send a new invitation
from Staff or Students. Console → the school → Support can sign everyone in that school out.

## The sealing key (`SECRETS_KEY`)

`SECRETS_KEY` seals the school database addresses and the connections' keys in the registry. It cannot be changed in
place yet: every sealed value would need sealing again with the new key, and there is no tool for that. If it leaked,
treat it as a breach ([breach.md](breach.md)): rotate every provider key (above) and every school database password
(through the School databases connection), then deploy with a new `SECRETS_KEY` and re-enter the connections' keys.
