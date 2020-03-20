import { RTMClient } from "@slack/rtm-api";
import { WebClient } from "@slack/web-api";
import { EventEmitter } from "events";
import { IUserData, User } from "../structures/user";
import { IChannelData, Channel } from "../structures/channel";
import { ITeamData, Team } from "../structures/team";
import * as ua from "useragent-generator";

export interface IClientOpts {
	token: string;
	cookie?: string;
}

export class Client extends EventEmitter {
	public teams: Map<string, Team> = new Map();
	public channels: Map<string, Channel> = new Map();
	public rtm: RTMClient;
	public web: WebClient;
	public user: User | null = null;
	constructor(private opts: IClientOpts) {
		super();
		const useragent = ua.chrome("79.0.3945.117");
		// tslint:disable-next-line no-any
		const webHeaders: any = this.opts.cookie ? { headers: {
			"Cookie": `d=${this.opts.cookie}`,
			"User-Agent": useragent,
		}} : {};
		// tslint:disable-next-line no-any
		const rtmHeaders: any = this.opts.cookie ? { tls: { headers: {
			"Cookie": `d=${this.opts.cookie}`,
			"User-Agent": useragent,
		}}} : {};
		this.web = new WebClient(this.opts.token, webHeaders);
		this.rtm = new RTMClient(this.opts.token, rtmHeaders);
	}

	public async disconnect() {
		await this.rtm.disconnect();
	}

	public async connect() {
		return new Promise(async (resolve, reject) => {
			this.rtm.once("unable_to_rtm_start", (err) => {
				reject(err);
			});

			this.rtm.on("disconnected", () => {
				this.emit("disconnected");
			});

			this.rtm.on("authenticated", (data) => {
				resolve();
				this.addTeam(data.team);
				this.addUser({
					id: data.self.id as string,
					name: data.self.name as string,
					team_id: data.team.id as string,
				});
				this.user = this.getUser(data.self.id, data.team.id);
				this.emit("connected");
			});

			for (const ev of ["channel_joined", "group_joined", "mpim_joined", "im_created", "channel_created", "channel_rename", "group_rename"]) {
				this.rtm.on(ev, (data) => {
					if (this.user && this.user.team) {
						data.channel.team_id = this.user.team.id;
					}
					this.addChannel(data.channel);
				});
			}

			for (const ev of ["team_join", "user_change"]) {
				this.rtm.on(ev, (data) => {
					this.addUser(data.user);
				});
			}

			for (const ev of ["bot_added", "bot_changed"]) {
				this.rtm.on(ev, (data) => {
					this.addUser(data.bot);
				});
			}

			for (const ev of ["team_profile_change", "team_pref_change"]) {
				this.rtm.on("team_pref_change", async () => {
					if (this.user && this.user.team) {
						const ret = await this.web.team.info({
							team: this.user.team.id,
						});
						if (!ret || !ret.ok || !ret.team) {
							return;
						}
						this.addTeam(ret.team as ITeamData);
					}
				});
			}

			this.rtm.on("team_rename", (data) => {
				if (this.user && this.user.team) {
					this.addTeam({
						id: this.user.team.id,
						name: data.name,
					});
				}
			});

			try {
				await this.rtm.start();
			} catch (err) {
				reject(err);
			}
		});
	}

	public addUser(data: IUserData, createTeam = true) {
		const team = this.teams.get(data.team_id);
		if (team) {
			const user = team.users.get(data.id);
			if (user) {
				const oldUser = user._clone();
				user._patch(data);
				this.emit("changeUser", oldUser, user);
			} else {
				const newUser = new User(this, data);
				team.users.set(newUser.id, newUser);
				this.rtm.subscribePresence([newUser.id]);
				this.emit("addUser", newUser);
			}
		} else if (createTeam) {
			// tslint:disable-next-line no-any
			this.web.team.info({ team: data.team_id }).then((teamData: any) => {
				if (teamData.team) {
					this.addTeam(teamData.team);
					this.addUser(data, false);
				}
			});
		}
	}

	public getUser(userId: string, teamId: string): User | null {
		const team = this.teams.get(teamId);
		if (!team) {
			return null;
		}
		return team.users.get(userId) || null;
	}

	public addChannel(data: IChannelData) {
		let team: Team | null = null;
		const team_id = data.team_id || (data.shared_team_ids && data.shared_team_ids[0]);
		if (team_id) {
			team = this.teams.get(team_id) || null;
		}
		const chanMap = team ? team.channels : this.channels;
		const chan = chanMap.get(data.id);
		if (chan) {
			const oldChan = chan._clone();
			chan._patch(data);
			this.emit("changeChannel", oldChan, chan);
		} else {
			const newChan = new Channel(this, data);
			chanMap.set(newChan.id, newChan);
			this.emit("addChannel", newChan);
		}
	}

	public getChannel(channelId: string, teamId: string): Channel | null {
		const team = this.teams.get(teamId);
		if (!team) {
			return null;
		}
		return team.channels.get(channelId) || null;
	}

	public addTeam(data: ITeamData) {
		const team = this.teams.get(data.id);
		if (team) {
			const oldTeam = team._clone();
			team._patch(data);
			this.emit("changeTeam", oldTeam, team);
		} else {
			const newTeam = new Team(this, data);
			this.teams.set(newTeam.id, newTeam);
			this.emit("addTeam", newTeam);
		}
	}

	public getTeam(teamId: string): Team | null {
		return this.teams.get(teamId) || null;
	}
}
