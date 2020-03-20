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
	blocks?: any[];
	attachments?: any[];
	subtype?: string;
	thread_ts?: string;
	files?: any[];
	ts: string;
}

export class Message extends Base {
	public channel: Channel;
	public user: User;
	public ts: string;
	public text: string | null = null;
	public blocks: any[] | null = null;
	public attachments: any[] | null = null;
	public meMessage: boolean;
	public threadTs: string | null = null;
	public files: any[] | null = null;

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
	}

	public get empty(): boolean {
		return !(this.text || (this.attachments && this.attachments.length > 0) || (this.blocks && this.blocks.length > 0));
	}
}
