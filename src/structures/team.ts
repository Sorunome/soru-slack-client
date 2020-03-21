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
import { IconBase, IIconData } from "./base";
import { IChannelData, Channel } from "./channel";
import { IUserData, User } from "./user";

export interface ITeamData {
	id: string;
	name?: string;
	domain?: string;
	icon?: IIconData;
}

export class Team extends IconBase {
	public channels: Map<string, Channel> = new Map();
	public users: Map<string, User> = new Map();;
	public id: string;
	public name: string;
	public domain: string;
	public email: string | null = null;
	public emailDomain: string | null = null;
	public icon: IIconData | null = null;
	public enterpriseId: string | null = null;
	public enterpriseName: string | null = null;
	public partial = true;
	constructor(client: Client, data: ITeamData) {
		super(client);
		this._patch(data);
	}

	public _patch(data: ITeamData) {
		this.id = data.id;
		if (data.hasOwnProperty("name")) {
			this.name = data.name!;
		}
		if (data.hasOwnProperty("domain")) {
			this.domain = data.domain!;
		}
		if (data.hasOwnProperty("icon")) {
			this.icon = data.icon || null;
		}
	}

	public async joinAllChannels() {
		if (this.partial) {
			await this.load();
		}
		for (const [, channel] of this.channels) {
			await channel.join();
		};
	}

	public async load() {
		// first load the team itself
		{
			const ret = await this.client.web(this.id).team.info({
				team: this.id,
			});
			if (!ret || !ret.ok || !ret.team) {
				throw new Error("Bad response");
			}
			this._patch(ret.team as ITeamData);
		}
		// next load in the channels
		{
			const ret = await this.client.web(this.id).conversations.list({
				types: "public_channel,private_channel,mpim,im",
				limit: 1000,
			});
			if (!ret || !ret.ok || !ret.channels) {
				throw new Error("Bad response");
			}
			for (const channelData of ret.channels as IChannelData[]) {
				channelData.team_id = this.id;
				this.client.addChannel(channelData);
			}
		}
		// next load in the users
		{
			const ret = await this.client.web(this.id).users.list();
			if (!ret || !ret.ok || !ret.members) {
				throw new Error("Bad response");
			}
			for (const userData of ret.members as IUserData[]) {
				this.client.addUser(userData);
			}
		}
		this.partial = false;
	}
}
