import { Client } from "./client";
import { Base, IconBase, IIconData } from "./base";
import { Team } from "./team";
import { User } from "./user";

export interface IBotData {
	bot_id: string;
	team_id: string;
	user_id: string;
	name?: string;
	username?: string;
	icons?: IIconData;
	bot_profile?: any; // tslint:disable-line no-any
}

export class Bot extends IconBase {
	public team: Team;
	public user: User | null = null;
	public id: string;
	public name: string;
	public displayName: string;
	public partial: boolean = true;
	constructor(client: Client, data: IBotData) {
		super(client);
		const team = this.client.teams.get(data.team_id);
		if (!team) {
			throw new Error("team not found!");
		}
		this.team = team;
		this._patch(data);
		this.partial = !(data.icons && this.user);
	}

	public get fullId(): string {
		return `${this.team.id}${this.client.separator}${this.id}`;
	}

	public _patch(data: IBotData) {
		if (data.hasOwnProperty("bot_id")) {
			this.id = data.bot_id;
		}
		if (data.hasOwnProperty("name") || data.hasOwnProperty("bot_profile")) {
			this.name = (data.bot_profile && data.bot_profile.name) || data.name!;
		}
		if (data.hasOwnProperty("username")) {
			this.displayName = data.username!;
		}
		if (!this.displayName) {
			this.displayName = this.name;
		}
		if (data.hasOwnProperty("user_id")) {
			const user = this.team.users.get(data.user_id);
			if (user) {
				this.user = user;
			}
		}
		this.icon = (data.bot_profile && data.bot_profile.icons) || data.icons || null;
	}

	public async load() {
		const ret = await this.client.web(this.team.id).bots.info({
			bot: this.id,
		});
		if (!ret || !ret.ok || !ret.bot) {
			throw new Error("Bad response");
		}
		(ret.bot as IBotData).team_id = this.team.id;
		const data = ret.bot as IBotData;
		if (data.hasOwnProperty("name")) {
			this.name = data.name!;
		}
		if (data.hasOwnProperty("user_id")) {
			const user = this.team.users.get(data.user_id);
			if (user) {
				this.user = user;
			}
		}
		this.partial = false;
	}
}
