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
import { Base, IconBase, IIconData } from "./base";
import { Team } from "./team";
import { Channel, IChannelData } from "./channel";

export interface IUserData {
	id: string;
	team_id: string;
	name?: string;
	color?: string;
	real_name?: string;
	profile?: IIconData | {
		real_name?: string;
		display_name?: string;
		status_text?: string;
		status_emoji?: string;
	};
	icons?: IIconData;
	is_bot?: boolean;
}

export class User extends IconBase {
	public team: Team;
	public id: string;
	public name: string;
	public color: string;
	public displayName: string;
	public realName: string;
	public statusText: string | null = null;
	public statusEmoji: string | null = null;
	public partial = true;
	public bot: boolean = false;
	private imChannel: Channel | null = null;
	constructor(client: Client, data: IUserData) {
		super(client);
		const team = this.client.teams.get(data.team_id);
		if (!team) {
			throw new Error("team not found!");
		}
		this.team = team;
		this._patch(data);
		this.partial = !(data.profile || data.icons);
	}

	public get fullId(): string {
		return `${this.team.id}${this.client.separator}${this.id}`;
	}

	public async im(): Promise<Channel | null> {
		if (this.imChannel) {
			return this.imChannel;
		}
		const reply = await this.client.web(this.team.id).conversations.open({
			return_im: true,
			users: this.id,
		});
		if (!reply || !reply.ok || !reply.channel) {
			return null;
		}
		const chanData = reply.channel as IChannelData;
		chanData.team_id = this.team.id;
		let chan = this.client.getChannel(chanData.id, this.team.id);
		if (chan) {
			this.imChannel = chan;
			return chan;
		}
		this.client.addChannel(chanData);
		chan = this.client.getChannel(chanData.id, this.team.id);
		if (chan) {
			this.imChannel = chan;
			return chan;
		}
		return null;
	}

	public _patch(data: IUserData) {
		if (data.hasOwnProperty("id")) {
			this.id = data.id;
		}
		if (data.hasOwnProperty("name")) {
			this.name = (data.name) as string;
		}
		if (data.hasOwnProperty("color")) {
			this.color = data.color!;
		}
		if (!this.realName || data.hasOwnProperty("profile") || data.hasOwnProperty("real_name")) {
			this.realName = (data.profile && data.profile.real_name as string) || data.real_name || this.name;
		}
		if (!this.displayName || data.hasOwnProperty("profile")) {
			this.displayName = (data.profile && data.profile.display_name as string) || this.realName;
		}
		if (!this.icon || data.hasOwnProperty("icons") || data.hasOwnProperty("profile")) {
			this.icon = (data.icons || data.profile || null) as IIconData | null;
		}
		if (data.hasOwnProperty("is_bot")) {
			this.bot = Boolean(data.is_bot);
		}
		if (data.profile && data.profile.status_text) {
			this.statusText = data.profile.status_text as string;
		}
		if (data.profile && data.profile.status_emoji) {
			this.statusEmoji = data.profile.status_emoji as string;
		}
	}

	public async load() {
		const ret = await this.client.web(this.team.fakeId || this.team.id).users.info({
			user: this.id,
		});
		if (!ret || !ret.ok || !ret.user) {
			throw new Error("Bad response");
		}
		this._patch(ret.user as IUserData);
		this.partial = false;
	}
}
