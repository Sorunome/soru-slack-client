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
