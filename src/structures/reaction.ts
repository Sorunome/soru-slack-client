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
import { Base } from "./base";
import { Message } from "./message";

export interface IReactionData {
	type: string;
	user: string;
	item: {
		type: string;
		channel: string;
		ts: string;
	};
	reaction: string;
	item_user: string;
	event_ts: string;
	ts: string;
	team_id?: string;
}

export class Reaction extends Base {
	public ts: string;
	public reaction: string;
	public message: Message;
	constructor(client: Client, data: IReactionData, teamId?: string) {
		super(client);
		this.message = new Message(client, data.item, teamId || data.team_id, data.item.channel, data.user);
		this._patch(data);
	}

	public _patch(data: IReactionData) {
		this.ts = data.ts;
		this.reaction = data.reaction;
	}
}
