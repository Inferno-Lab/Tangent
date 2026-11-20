-- kind: contract
-- No school is a demo school any more: every school signs in with real codes, and none carries sample content.
alter table schools drop column if exists demo;
