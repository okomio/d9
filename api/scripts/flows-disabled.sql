-- Flows that stay disabled while the areas are being separated.
--
-- The reference instance ships these active and their logic performs external
-- requests, which the migration work must not trigger. Run this after restoring
-- a dump; it is idempotent. Re-enable by setting their status back to 'active'.

update directus_flows
set status = 'inactive'
where id in (
	'c1c6344d-109d-4dd4-acfc-5050e9439f30',
	'b22b66ab-12d6-4985-9ead-b835e8c83627',
	'8c5af405-057c-4af3-b5e3-2b25ecd18175',
	'74ae231c-b76e-4c1f-bd00-9b68b71c644f',
	'32093017-8181-4fda-bea6-e90c06060903',
	'4032f5a6-077b-4312-b35b-85b995d1f150',
	'f9b284ff-6180-4c47-aee8-43c55991a45a',
	'c73d16df-f269-4119-923a-90217c5fceb2',
	'c513ec50-a1ea-412a-8045-33edc3a281a3',
	'9dfd2f74-b185-4b25-959d-3a99acc61844',
	'f43448ba-11c2-4d22-bcdb-c7694b7609f3',
	'091a2285-bf33-4348-ab89-6a98c7b554b1',
	'8d71155c-efd7-499f-bd29-be4a063cc1cf',
	'572c554d-6bbe-41fa-a8c6-ce9550034307',
	'e45b873c-44a3-408a-94c2-e732a0d5c7aa',
	'a871ef13-e1c5-4ca6-945f-f07fa1daedcc',
	'8135f52d-9dcb-42e1-9bb9-ab1864a9c29a'
);
