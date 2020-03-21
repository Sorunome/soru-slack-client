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
import { Channel } from "./channel";
import { User } from "./user";
import { Base } from "./base";

export interface IMessageData {
	team_id?: string;
	channel?: string;
	item?: {
		channel?: string;
	};
	user?: string;
	bot_id?: string;
	text?: string;
	blocks?: any[]; // tslint:disable-line no-any
	attachments?: any[]; // tslint:disable-line no-any
	subtype?: string;
	thread_ts?: string;
	files?: any[]; // tslint:disable-line no-any
	ts: string;
}

export class Message extends Base {
	public channel: Channel;
	public user: User;
	public ts: string;
	public text: string | null = null;
	public blocks: any[] | null = null; // tslint:disable-line no-any
	public attachments: any[] | null = null; // tslint:disable-line no-any
	public meMessage: boolean;
	public threadTs: string | null = null;
	public files: any[] | null = null; // tslint:disable-line no-any
	public partial = true;

	constructor(client: Client, data: IMessageData, teamId?: string, channelId?: string, userId?: string) {
		super(client);
		if (!teamId) {
			teamId = data.team_id as string;
		}
		if (!channelId) {
			channelId = (data.channel || (data.item && data.item.channel)) as string;
		}
		if (!userId) {
			userId = (data.user || data.bot_id) as string;
		}
		const channel = this.client.getChannel(channelId, teamId);
		const user = this.client.getUser(userId, teamId);
		if (!channel || !user) {
			throw new Error("User or channel not found");
		}
		this.channel = channel;
		this.user = user;
		this._patch(data);
	}

	public _patch(data: IMessageData) {
		this.ts = data.ts;
		if (data.hasOwnProperty("text")) {
			this.text = data.text!;
		}
		if (data.hasOwnProperty("blocks")) {
			this.blocks = data.blocks!;
		}
		if (data.hasOwnProperty("attachments")) {
			this.attachments = data.attachments!;
		}
		this.meMessage = data.subtype === "me_message";
		if (data.hasOwnProperty("thread_ts")) {
			this.threadTs = data.thread_ts!;
		}
		if (data.hasOwnProperty("files")) {
			this.files = data.files!;
		}

		if (this.text || this.blocks || this.attachments || this.files) {
			this.partial = false;
		}
	}

	public get empty(): boolean {
		return !(this.text || (this.attachments && this.attachments.length > 0) || (this.blocks && this.blocks.length > 0));
	}
}
