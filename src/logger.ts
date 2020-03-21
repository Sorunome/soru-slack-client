/*
Copyright 2020 soru-slack-client
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { inspect } from "util";

// tslint:disable-next-line no-any
export type LoggerFunc = (mod: string, args: any[]) => void;
export interface ILoggerMap {
	silly: LoggerFunc;
	debug: LoggerFunc;
	verbose: LoggerFunc;
	info: LoggerFunc;
	warn: LoggerFunc;
	error: LoggerFunc;
}

const LOGGER_LEVELS = ["silly", "debug", "verbose", "info", "warn", "error"];

export class Logger {
	public static level: string = "info";
	public static setLogger(l: ILoggerMap) {
		Logger.logger = l;
	}

	private static logger: ILoggerMap | null = null;

	constructor(private module: string) { }

	// tslint:disable-next-line no-any
	public error(...msg: any[]) {
		this.log("error", msg);
	}

	// tslint:disable-next-line no-any
	public warn(...msg: any[]) {
		this.log("warn", msg);
	}

	// tslint:disable-next-line no-any
	public info(...msg: any[]) {
		this.log("info", msg);
	}

	// tslint:disable-next-line no-any
	public verbose(...msg: any[]) {
		this.log("verbose", msg);
	}

	// tslint:disable-next-line no-any
	public debug(...msg: any[]) {
		this.log("debug", msg);
	}

	// tslint:disable-next-line no-any
	public silly(...msg: any[]) {
		this.log("silly", msg);
	}

	// tslint:disable-next-line no-any
	private log(logLevel: string, msg: any[]) {
		if (Logger.logger) {
			Logger.logger[logLevel](this.module, msg);
			return;
		}
		if (LOGGER_LEVELS.indexOf(logLevel) < LOGGER_LEVELS.indexOf(Logger.level)) {
			return;
		}
		const msgStr = msg.map((item) => {
			return typeof(item) === "string" ? item : inspect(item);
		}).join(" ");

		// tslint:disable-next-line no-console
		console.log(`[${logLevel}] ${this.module}: ${msgStr}`);
	}
}
