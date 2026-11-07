CREATE TABLE `monitor_outside_days` (
	`date` text PRIMARY KEY NOT NULL,
	`expected` integer NOT NULL,
	`observed` integer NOT NULL,
	`passed` integer NOT NULL
);
