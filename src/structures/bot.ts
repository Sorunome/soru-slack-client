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
}

export class Bot extends IconBase {
	public team: Team;
	public user: User | null = null;
	public id: string;
	public name: string;
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

	public get displayName(): string {
		return this.name;
	}

	public _patch(data: IBotData) {
		if (data.hasOwnProperty("bot_id")) {
			this.id = data.bot_id;
		}
		if (data.hasOwnProperty("name") || data.hasOwnProperty("username")) {
			this.name = (data.name || data.username) as string;
		}
		if (data.hasOwnProperty("user_id")) {
			const user = this.team.users.get(data.user_id);
			if (user) {
				this.user = user;
			}
		}
		if (!this.icon || data.hasOwnProperty("icons")) {
			this.icon = data.icons || null;
		}
	}

	public async load() {
		const ret = await this.client.web(this.team.id).bots.info({
			bot: this.id,
		});
		if (!ret || !ret.ok || !ret.bot) {
			throw new Error("Bad response");
		}
		(ret.bot as IBotData).team_id = this.team.id;
		this._patch(ret.bot as IBotData);
		this.partial = false;
	}
}
