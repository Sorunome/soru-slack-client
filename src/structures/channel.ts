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
import { Base, IIconData, ICreatorValue } from "./base";
import { Team } from "./team";
import { User } from "./user";
import { Util } from "../util";

type ChannelTypes = "channel" | "group" | "mpim" | "im" | "unknown";

export interface IChannelData {
	id: string;
	name?: string;
	is_channel: boolean;
	is_group: boolean;
	is_mpim: boolean;
	is_im: boolean;
	topic?: ICreatorValue;
	purpose?: ICreatorValue;
	private?: boolean;
	team_id?: string;
	shared_team_ids?: string[];
	user?: string;
}

interface ISendMessage {
	text: string;
	blocks?: any[]; // tslint:disable-line no-any
}

type SendableType = ISendMessage | string;

export interface ISendOpts {
	username?: string | null;
	iconUrl?: string | null;
	iconEmoji?: string | null;
	threadTs?: string | null;
	asUser?: boolean | null;
}

export class Channel extends Base {
	public members: Map<string, User> = new Map();
	public id: string;
	public name: string | null = null;
	public type: ChannelTypes;
	public topic: string | null = null;
	public purpose: string | null = null;
	public private: boolean;
	public team: Team;
	public partial = true;
	constructor(client: Client, data: IChannelData) {
		super(client);
		const teamId = data.team_id || (data.shared_team_ids && data.shared_team_ids[0]);
		if (!teamId) {
			throw new Error("no associated team!");
		}
		const team = this.client.teams.get(teamId);
		if (!team) {
			throw new Error("team not found!");
		}
		this.team = team;
		this._patch(data);
	}

	public get fullId(): string {
		return `${this.team.id}${this.client.separator}${this.id}`;
	}

	public _patch(data: IChannelData) {
		this.id = data.id;
		this.name = data.name || null;
		let type: ChannelTypes = "unknown";
		if (data.is_channel) {
			type = "channel";
		} else if (data.is_mpim) {
			type = "mpim";
		} else if (data.is_group) {
			type = "group";
		} else if (data.is_im) {
			type = "im";
		}
		this.type = type;
		if (data.hasOwnProperty("topic")) {
			this.topic = data.topic!.value;
		}
		if (data.hasOwnProperty("purpose")) {
			this.purpose = data.purpose!.value;
		}
		this.private = Boolean(data.is_im || data.private);
		if (data.hasOwnProperty("user")) {
			const userObj = this.team.users.get(data.user!);
			if (userObj) {
				this.members.set(userObj.id, userObj);
			}
		}
	}

	public async load() {
		// first load the info
		{
			const ret = await this.client.web(this.team.id).conversations.info({
				channel: this.id,
			});
			if (!ret || !ret.ok || !ret.channel) {
				throw new Error("Bad response");
			}
			this._patch(ret.channel as IChannelData);
		}
		// now load the members
		{
			const ret = await this.client.web(this.team.id).conversations.members({
				channel: this.id,
			});
			if (!ret || !ret.ok || !ret.members) {
				throw new Error("Bad response");
			}
			for (const memberId of ret.members as string[]) {
				const userObj = this.team.users.get(memberId);
				if (userObj) {
					this.members.set(userObj.id, userObj);
				}
			}
		}
		this.partial = false;
	}

	public async join() {
		if (["im"].includes(this.type)) {
			return;
		}
		await this.client.web(this.team.id).conversations.join({
			channel: this.id,
		});
	}

	public async sendMessage(sendable: SendableType, opts?: ISendOpts): Promise<string> {
		const send: any = { // tslint:disable-line no-any
			...this.resolveSendable(sendable),
			channel: this.id,
		};
		this.applyOpts(send, opts);
		const ret = await this.client.web(this.team.id).chat.postMessage(send);
		return ret.ts as string;
	}

	public async sendMeMessage(sendable: SendableType): Promise<string> {
		const send = this.resolveSendable(sendable);
		if (this.isBotToken()) {
			send.text = `_${send.text}_`;
			return await this.sendMessage(send);
		}
		const ret = await this.client.web(this.team.id).chat.meMessage({
			...send,
			channel: this.id,
		});
		return ret.ts as string;
	}

	public async deleteMessage(ts: string, opts?: ISendOpts) {
		const send: any = { // tslint:disable-line no-any
			channel: this.id,
			ts,
		};
		this.applyOpts(send, opts);
		await this.client.web(this.team.id).chat.delete(send);
	}

	public async editMessage(sendable: SendableType, ts: string, opts?: ISendOpts): Promise<string> {
		const send: any = { // tslint:disable-line no-any
			...this.resolveSendable(sendable),
			channel: this.id,
			ts,
		};
		this.applyOpts(send, opts);
		const ret = await this.client.web(this.team.id).chat.update(send);
		return ret.ts as string;
	}

	public async sendFile(urlOrBuffer: string | Buffer, title: string, filename?: string): Promise<string> {
		if (!filename) {
			filename = title;
		}
		let buffer: Buffer;
		if (typeof urlOrBuffer === "string") {
			buffer = await Util.DownloadFile(urlOrBuffer);
		} else {
			buffer = urlOrBuffer;
		}
		const ret = await this.client.web(this.team.id).files.upload({
			filename,
			file: buffer,
			title,
			filetype: "auto",
			channels: this.id,
		});
		return ret.ts as string;
	}

	public async sendReaction(ts: string, reaction: string) {
		await this.client.web(this.team.id).reactions.add({
			channel: this.id,
			timestamp: ts,
			name: reaction,
		});
	}

	private resolveSendable(sendable: SendableType): ISendMessage {
		const msg: ISendMessage = typeof sendable === "string" ? {
			text: sendable,
		} : sendable;
		if (this.isBotToken() && msg.blocks && msg.blocks[0] && msg.blocks[0].type === "rich_text") {
			delete msg.blocks;
		}
		return msg;
	}

	private applyOpts(send: any, opts?: ISendOpts) { // tslint:disable-line no-any
		if (opts) {
			if (opts.username) {
				send.username = opts.username;
				if (opts.iconUrl) {
					send.icon_url = opts.iconUrl;
				}
				if (opts.iconEmoji) {
					send.icon_emoji = opts.iconEmoji;
				}
			}
			if (opts.asUser) {
				send.as_user = true;
			}
			if (opts.threadTs) {
				send.thread_ts = opts.threadTs;
			}
		}
	}

	private isBotToken(): boolean {
		const token = this.client.tokens.get(this.team.id) || "";
		return token.startsWith("xoxb");
	}
}
