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
	private webMap: Map<string, WebClient> = new Map();
	private rtmMap: Map<string, RTMClient> = new Map();
	private tokenMap: Map<string, string> = new Map();
	public teams: Map<string, Team> = new Map();
	public users: Map<string, User> = new Map();
	constructor(private opts: IClientOpts) {
		super();
	}

	public web(teamId: string): WebClient {
		const web = this.webMap.get(teamId);
		if (!web) {
			throw new Error("Team not found");
		}
		return web;
	}

	public rtm(teamId: string): RTMClient {
		const rtm = this.rtmMap.get(teamId);
		if (!rtm) {
			throw new Error("Team not found");
		}
		return rtm;
	}

	public async disconnect() {
		for (const [, rtm ] of this.rtmMap) {
			await rtm.disconnect();
		}
	}

	public async connect() {
		if (this.opts.token) {
			await this.addToken(this.opts.token);
		}
	}

	public async addToken(token: string) {
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
		const web = new WebClient(token, webHeaders);
		const rtm = new RTMClient(token, rtmHeaders);
		return new Promise(async (resolve, reject) => {
			let teamId = "";
			rtm.once("unable_to_rtm_start", (err) => {
				reject(err);
			});

			rtm.on("disconnected", () => {
				this.emit("disconnected");
			});

			rtm.on("authenticated", (data) => {
				teamId = data.team.id as string;
				this.rtmMap.set(teamId, rtm);
				this.webMap.set(teamId, web);
				this.tokenMap.set(token, teamId);
				this.addTeam(data.team);
				this.addUser({
					id: data.self.id as string,
					name: data.self.name as string,
					team_id: data.team.id as string,
				});
				const clientUser = this.getUser(data.self.id, data.team.id);
				if (clientUser) {
					this.users.set(teamId, clientUser);
				}
			});

			rtm.on("ready", () => {
				resolve();
				this.emit("connected");
			})

			for (const ev of ["channel_joined", "group_joined", "mpim_joined", "im_created", "channel_created", "channel_rename", "group_rename"]) {
				rtm.on(ev, (data) => {
					data.channel.team_id = teamId;
					this.addChannel(data.channel);
				});
			}

			for (const ev of ["team_join", "user_change"]) {
				rtm.on(ev, (data) => {
					data.user.team_id = teamId;
					this.addUser(data.user);
				});
			}

			for (const ev of ["bot_added", "bot_changed"]) {
				rtm.on(ev, (data) => {
					data.bot.team_id = teamId;
					this.addUser(data.bot);
				});
			}

			for (const ev of ["team_profile_change", "team_pref_change"]) {
				rtm.on("team_pref_change", async () => {
					const ret = await this.web(teamId).team.info({
						team: teamId,
					});
					if (!ret || !ret.ok || !ret.team) {
						return;
					}
					this.addTeam(ret.team as ITeamData);
				});
			}

			rtm.on("team_rename", (data) => {
				this.addTeam({
					id: teamId,
					name: data.name,
				});
			});

			try {
				await rtm.start();
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
				this.rtm(team.id).subscribePresence([newUser.id]);
				this.emit("addUser", newUser);
			}
		} else if (createTeam) {
			// tslint:disable-next-line no-any
			this.web(data.team_id).team.info({ team: data.team_id }).then((teamData: any) => {
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

	public addChannel(data: IChannelData, createTeam = true) {
		const teamId = data.team_id || (data.shared_team_ids && data.shared_team_ids[0]);
		if (!teamId) {
			return;
		}
		const team = this.teams.get(teamId);
		if (team) {
			const chan = team.channels.get(data.id);
			if (chan) {
				const oldChan = chan._clone();
				chan._patch(data);
				this.emit("changeChannel", oldChan, chan);
			} else {
				const newChan = new Channel(this, data);
				team.channels.set(newChan.id, newChan);
				this.emit("addChannel", newChan);
			}
		} else if (createTeam) {
			// tslint:disable-next-line no-any
			this.web(teamId).team.info({ team: teamId }).then((teamData: any) => {
				if (teamData.team) {
					this.addTeam(teamData.team);
					this.addChannel(data, false);
				}
			});
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
