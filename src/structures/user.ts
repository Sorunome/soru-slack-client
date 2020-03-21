import { Client } from "./client";
import { Base, IconBase, IIconData } from "./base";
import { Team } from "./team";

export interface IUserData {
	id?: string;
	bot_id?: string;
	team_id: string;
	name?: string;
	username?: string;
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
	public fullBot: boolean = false;
	constructor(client: Client, data: IUserData) {
		super(client);
		const team = this.client.teams.get(data.team_id);
		if (!team) {
			throw new Error("team not found!");
		}
		this.team = team;
		this._patch(data);
		this.partial = !(data.profile || data.icons || this.fullBot);
	}

	public _patch(data: IUserData) {
		if (data.hasOwnProperty("id") || data.hasOwnProperty("bot_id")) {
			this.id = (data.id || data.bot_id) as string;
		}
		if (data.hasOwnProperty("name") || data.hasOwnProperty("username")) {
			this.name = (data.name || data.username) as string;
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
		if (!this.fullBot && data.bot_id) {
			this.bot = true;
			this.fullBot = true;
		}
	}

	public async load() {
		const ret = await this.client.web(this.team.id).users.info({
			user: this.id,
		});
		if (!ret || !ret.ok || !ret.user) {
			throw new Error("Bad response");
		}
		this._patch(ret.user as IUserData);
		this.partial = false;
	}
}
