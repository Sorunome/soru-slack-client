import { Client } from "../client/client";
import { Base, IIconData, ICreatorValue } from "./base";
import { Team } from "./team";
import { User } from "./user";

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

export class Channel extends Base {
	public users: Map<string, User> = new Map();
	public id: string;
	public name: string | null = null;
	public type: ChannelTypes;
	public topic: string | null = null;
	public purpose: string | null = null;
	public private: boolean;
	public team: Team | null = null;
	public partial = true;
	constructor(client: Client, data: IChannelData) {
		super(client);
		this._patch(data);
		const team_id = data.team_id || (data.shared_team_ids && data.shared_team_ids[0]);
		if (team_id) {
			this.team = this.client.teams.get(team_id) || null;
		}
	}

	public _patch(data: IChannelData) {
		const team_id = data.team_id || (data.shared_team_ids && data.shared_team_ids[0]) || (this.team && this.team.id);
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
		if (team_id && data.hasOwnProperty("user")) {
			const userObj = this.client.getUser(data.user!, team_id);
			if (userObj) {
				this.users.set(userObj.id, userObj);
			}
		}
	}

	public async load() {
		// first load the info
		{
			const ret = await this.client.web.conversations.info({
				channel: this.id,
			});
			if (!ret || !ret.ok || !ret.channel) {
				throw new Error("Bad response");
			}
			this._patch(ret.channel as IChannelData);
		}
		// now load the members
		if (this.team) {
			const ret = await this.client.web.conversations.members({
				channel: this.id,
			});
			if (!ret || !ret.ok || !ret.members) {
				throw new Error("Bad response");
			}
			for (const memberId of ret.members as string[]) {
				const userObj = this.client.getUser(memberId, this.team.id);
				if (userObj) {
					this.users.set(userObj.id, userObj);
				}
			}
		}
		this.partial = false;
	}

	public async sendMessage(sendable: SendableType): Promise<string> {
		const ret = await this.client.web.chat.postMessage({
			...this.resolveSendable(sendable),
			channel: this.id,
			as_user: true,
		});
		return ret.ts as string;
	}

	public async sendMeMessage(sendable: SendableType): Promise<string> {
		const ret = await this.client.web.chat.meMessage({
			...this.resolveSendable(sendable),
			channel: this.id,
		});
		return ret.ts as string;
	}

	public async deleteMessage(ts: string) {
		await this.client.web.chat.delete({
			channel: this.id,
			ts,
			as_user: true,
		});
	}

	public async replyMessage(sendable: SendableType, ts: string): Promise<string> {
		const ret = await this.client.web.chat.postMessage({
			...this.resolveSendable(sendable),
			channel: this.id,
			as_user: true,
			thread_ts: ts,
		});
		return ret.ts as string;
	}

	public async editMessage(sendable: SendableType, ts: string): Promise<string> {
		const ret = await this.client.web.chat.update({
			...this.resolveSendable(sendable),
			channel: this.id,
			as_user: true,
			ts,
		});
		return ret.ts as string;
	}

	private resolveSendable(sendable: SendableType): ISendMessage {
		return typeof sendable === "string" ? {
			text: sendable,
		} : sendable;
	}
}
