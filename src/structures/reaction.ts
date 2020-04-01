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
	public static async construct(client: Client, data: IReactionData): Promise<Reaction> {
		const { channel, author } = await client.getChannelAndAuthor(data);
		const message = new Message(client, data.item, channel, author);
		return new Reaction(client, data, message);
	}

	public ts: string;
	public reaction: string;
	public message: Message;

	constructor(client: Client, data: IReactionData, message: Message) {
		super(client);
		this.message = message;
		this._patch(data);
	}

	public _patch(data: IReactionData) {
		this.ts = data.ts;
		this.reaction = data.reaction;
	}
}
