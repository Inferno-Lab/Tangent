# Restore a school from a backup

Use when a school's records were damaged (a wrong import that undo cannot reach, a bad bulk change, a broken migration).
A restore replaces the school's whole database with the backup's copy; everything since that backup is lost unless it is
re-entered, so first try the narrower fixes.

## Before restoring

1. **Narrower fixes first.** A wrong import: console → the school → Data → Imports → Undo (each batch undoes on its own).
   A wrong setting: console → the school → Configuration → History → Roll back. A wrong grade or fee: the school fixes it
   in the admin (with its audit trail).
2. **Find the right backup.** Console → the school → Backups lists each with its time (UTC) and who took it. Nightly
   backups run on their own; a manual one is taken before every move and every restore.
3. **Tell the school** what will be lost: everything entered after the backup's time. Agree a time when nobody is entering
   records (after school hours on its own clock).

## Restoring

1. Console → the school → Backups → the backup → **Restore**. It is an action that a second person approves under
   Approvals (the rule is on Console settings → Approvals).
2. When approved, the console takes a fresh backup of the data as it is now (kept as "before restoring"), brings an older
   backup forward through any migrations added since, then replaces the data. The action's summary says how many rows
   and tables came back.

## After

- Open the school's admin and check the pages that were wrong (and the dashboard's counts).
- Console → Health → Restore drills keeps the record that restores work; if this was not a drill, note why in the action.
- If the restore was wrong, restore the "before restoring" backup the same way.
