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

import { Client } from "./client";

export interface IIconData {
	[key: string]: string | boolean;
}

export interface ICreatorValue {
	value: string;
	creator: string;
	last_set: number;
}

export class Base {
	constructor(public readonly client: Client) { }

	public _clone() {
		return Object.assign(Object.create(this), this);
	}
}

export class IconBase extends Base {
	protected icon: IIconData | null;

	public get iconUrl(): string | null {
		if (!this.icon) {
			return null;
		}
		const key = Object.keys(this.icon).filter((el) => {
			return el.startsWith("image_") && typeof this.icon![el] === "string";
		}).sort((e1, e2) => {
			const n1 = e1.substring("image_".length);
			const n2 = e2.substring("image_".length);
			// we want to sort "original" to the top
			if (n1 === "original") {
				return -1;
			}
			if (n2 === "original") {
				return 1;
			}
			// buuut everything else to the bottom
			const nn1 = Number(n1);
			const nn2 = Number(n2);
			if (isNaN(nn1)) {
				return 1;
			}
			if (isNaN(nn2)) {
				return -1;
			}
			return nn2 - nn1;
		})[0];
		return this.icon[key] as string || null;
	}

	public get iconEmoji(): string | null {
		return (this.icon && this.icon.emoji as string) || null;
	}
}
