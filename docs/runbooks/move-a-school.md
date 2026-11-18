# Move a school to another cell or region

A cell is a set of schools on one database server and one deploy target, in one region. Move a school when a cell is
full, when a server is retired, or when the school's contract keeps its data in a region.

1. **Check the target.** Console → Cells: the target accepts schools and has room. If the school's contract says its data
   stays in a region (school → Details → "The school's data stays in"), the target must be in that region; the console
   refuses a move elsewhere.
2. **Agree a time** with the school: a move between servers closes the school for writes for a few minutes.
3. Console → the school → Actions → **Move to another cell** → the cell. A second person approves.
4. The console takes a backup ("before moving"), copies the data to a new database on the target, checks every table's
   row count against the old one, then switches the school. Cells on the same server only change the record.
5. **After:** open the school's admin and app; the action's summary names the new database. The old database is kept
   until the next clean-up, so a failed move can be undone by moving back.
