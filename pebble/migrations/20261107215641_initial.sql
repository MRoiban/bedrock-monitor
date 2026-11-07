CREATE TABLE `monitor_cache` (
	`id` integer PRIMARY KEY NOT NULL,
	`snapshot` text,
	`attempt_at` integer,
	`failure` text,
	`outside` text,
	`outside_failure` text,
	`pressure` integer DEFAULT false NOT NULL
);
CREATE TABLE `monitor_results` (
	`pebble` text NOT NULL,
	`at` integer NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`pebble`, `at`)
);
CREATE INDEX `results_time` ON `monitor_results` (`at`);
CREATE TABLE `monitor_hours` (
	`pebble` text NOT NULL,
	`at` integer NOT NULL,
	`observed` integer NOT NULL,
	`failed` integer NOT NULL,
	PRIMARY KEY(`pebble`, `at`)
);
CREATE INDEX `hours_time` ON `monitor_hours` (`at`);
CREATE TABLE `monitor_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
CREATE TABLE `monitor_outside` (
	`id` text PRIMARY KEY NOT NULL,
	`observed_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`reachable` integer NOT NULL
);
CREATE INDEX `outside_time` ON `monitor_outside` (`observed_at`);
