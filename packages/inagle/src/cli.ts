#!/usr/bin/env bun
import { Command } from "commander";
import {
	registerCharacterCommand,
	registerItemsCommand,
	registerSearchCommand,
	registerSkillsCommand,
	registerStatsCommand,
	registerTeamsCommand,
} from "./cli-commands.js";
import { registerMenuCommand } from "./cli-menu.js";
import { registerPushCommand } from "./cli-push.js";

const program = new Command();

program.name("inagle").description("Inazuma Eleven Victory Road Data CLI").version("1.0.0");

// Register all commands
registerStatsCommand(program);
registerSearchCommand(program);
registerCharacterCommand(program);
registerMenuCommand(program);
registerItemsCommand(program);
registerSkillsCommand(program);
registerTeamsCommand(program);
registerPushCommand(program);

program.parse();
