import { Client } from "../client/client";
import { Base, IconBase, IIconData } from "./base";
import { Team } from "./team";

export interface IUserData {
	id: string;
	team_id: string;
	name: string;
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
	public statusText: string | null;
	public statusEmoji: string | null;
	public partial = true;
	public bot: boolean;
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

	public _patch(data: IUserData) {
		this.id = data.id;
		this.name = data.name;
		if (data.hasOwnProperty("color")) {
			this.color = data.color!;
		}
		this.realName = (data.profile && data.profile.real_name as string) || data.real_name || data.name;
		this.displayName = (data.profile && data.profile.display_name as string) || this.realName;
		this.icon = (data.icons || data.profile || null) as IIconData | null;
		this.bot = Boolean(data.is_bot);
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
