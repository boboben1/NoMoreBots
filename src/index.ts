import { setInterval } from 'timers';
import * as cheerio from 'cheerio';
import * as request from 'request';
import * as rsa from './rsa.js';
import * as fs from 'fs';
import * as path from 'path';
import * as prompt from 'prompt';

const VERSION = 1.0

class Config {
    refreshTime = 30000;
    constructor (public username: string, public password: string) {}
}

class Invite {
    from = '';
    isGroup: boolean;
    id = '';
}

class Program {

    config: Config;

    config_file = path.resolve('config.json');

    cookie?: any;

    profile_url: string;

    profile_name: string;

    g_session_id = '';

    loadConfigAndLogin() {
        if (this.config.refreshTime < 10000) {
            return console.error('Refresh time must be longer than 10000ms (10s)');
        }

        this.config.username = this.config.username.replace( /[^\x00-\x7F]/g, '' );
        this.config.password = this.config.password.replace( /[^\x00-\x7F]/g, '' );

        this.login({}, this.begin);
    }

    start() {

        console.log(this.config_file);
        prompt.start();

        if (process.argv.length > 2) {
            if (process.argv[2].toLowerCase() === 'reset') {
                fs.unlinkSync(this.config_file);
            }
        }

        if (!fs.existsSync(this.config_file)) {
            fs.writeFileSync(this.config_file, JSON.stringify(new Config('', '')));
        }

        const config_data = fs.readFileSync(this.config_file, 'utf-8');

        this.config = JSON.parse(config_data);

        if (this.config.username === '' || this.config.password === '') {
            return prompt.get(['username', 'password'], (err, result) => {
                if (err) {
                    return console.error(err);
                }

                this.config.username = result['username'];
                this.config.password = result['password'];

                fs.writeFileSync(this.config_file, JSON.stringify(this.config));

                this.loadConfigAndLogin();
            });
        }

        this.loadConfigAndLogin();

    }

    getProfileURL = (callback) => {
        const r: any = request.get({url: 'http://steamcommunity.com/my/home/', headers: {Cookie: this.cookie, Connection: 'keep-alive'}}, (err, res, body) => {
            if (err) {
                return console.error(err);
            }

            this.profile_url = r.uri.href;
            this.profile_name = this.profile_url.split('/')[4];

            console.log('Logged into ' + this.config.username);

            const $ = cheerio.load(body);

            $('script').each((i, elem) => {
               $(elem).html().split('\n').forEach((value, index, array) => {
                   if (value.trim().startsWith('g_sessionID =')) {
                       this.g_session_id = value.split('"')[1];
                   }
               });
            });

            this.cookie += '; sessionid=' + this.g_session_id;

            callback();
        });
    }

    getProfileLevel(profile_url: string, callback: (level: number) => void) {
        request.get({url: profile_url, headers: {Cookie: this.cookie, Connection: 'keep-alive'}}, (err, res, body) => {
            if (err) {
                return console.error(err);
            }

            const $ = cheerio.load(body);

            callback(+($('.friendPlayerLevel .friendPlayerLevelNum').html()));
        });
    }

    FriendAccept = (user_id: string, action: string) => {
        request.post({url: 'https://steamcommunity.com/id/' + this.profile_name + '/home_process', headers: {Cookie: this.cookie, Connection: 'keep-alive', Host: 'steamcommunity.com', Origin: 'http://steamcommunity.com'},
            form: {
                json: 1,
                xml: 1,
                action: 'approvePending',
                itype: 'friend',
                perform: action,
                id: user_id,
                sessionID: this.g_session_id
            }}, (err, res, body) => {
                if (err) {
                    return console.error(err);
                }
        });
    }

    GroupAccept = (group_id: string, action: string) => {
        request.post({url: 'https://steamcommunity.com/id/' + this.profile_name + '/home_process', headers: {Cookie: this.cookie, Connection: 'keep-alive', Host: 'steamcommunity.com', Origin: 'http://steamcommunity.com'},
            form: {
                json: 1,
                xml: 1,
                action: 'approvePending',
                itype: 'group',
                perform: action,
                id: group_id,
                sessionID: this.g_session_id
            }}, (err, res, body) => {
                if (err) {
                    return 'ERROR: ' + console.error(err);
                }
        });
    }

    getInvites = (callback: (invites: Array<Invite>) => void) => {
        request.get({url: this.profile_url + '/invites', headers: {Cookie: this.cookie, Connection: 'keep-alive'}}, (err, res, body) => {
            if (err) {
                return console.error(err);
            }

            const $ = cheerio.load(body);

            const invites: Array<Invite> = [];

             $('.invite_row').each((i, el) => {

                const href = $(el).find('.linkTitle').attr('href');

                if (href.indexOf('groups') !== -1) {
                    const user_href = $($(el).find('.memberRow').get(1)).find('.linkStandard').attr('href');

                    const id = $(el).find('.acceptDeclineBlock .linkStandard').attr('href').split('\'')[1];

                    invites.push({id: id, from: user_href, isGroup: true});

                } else if (href.indexOf('id') !== -1 || href.indexOf('profiles') !== -1) {
                    let user_profile_name = href;

                    user_profile_name = user_profile_name.replace('http://steamcommunity.com/id/', '');

                    user_profile_name = user_profile_name.replace('http://steamcommunity.com/profiles/', '');

                    invites.push({id: user_profile_name, from: href, isGroup: false});
                }
            });

            callback(invites);
        });
    }

    filterInvites = (invites: Array<Invite>) => {
        invites.forEach((invite, index, array) => {
            this.getProfileLevel(invite.from, level => {
               if (level <= 0) {

                    if (invite.isGroup) {
                        this.GroupAccept(invite.id, 'ignore');
                    } else {
                        this.FriendAccept(invite.id, 'ignore');
                    }

                    console.log('Ignoring invite from ' + invite.from);
               }
           });
        });
    }

    updateLoop = () => {
        setInterval(() => {
            this.getInvites(invites => {
                this.filterInvites(invites)
            });
        }, this.config.refreshTime);
    }

    begin = () => {
        this.getProfileURL(() =>
                this.updateLoop());
    }

    login(auth_options: {twofactorcode?: string, emailauth?: string}, callback) {
        request.post({url: 'https://steamcommunity.com/login/getrsakey/', form: {username: this.config.username}}, (err, httpResponse, _body) => {
            if (err) {
                return console.error(err);
            }

            const body = JSON.parse(_body);

            if (!body.success) {
                return console.error('Login Error: ' + body.message);
            }

            const exp: number = +(<string>body.publickey_exp);

            const pub_key = rsa.getPublicKey(body.publickey_mod, body.publickey_exp);

            const encrypted = <string>rsa.encrypt(this.config.password, pub_key);


            request.post({url: 'https://steamcommunity.com/login/dologin/', form: {
                username: this.config.username,
                password: encrypted,
                rsatimestamp: body.timestamp,
                twofactorcode: auth_options.twofactorcode || '',
                emailauth: auth_options.emailauth || ''
            }}, (err, httpResponse, _body) => {

                const body = JSON.parse(_body);

                if (!body.success) {
                    if (body.requires_twofactor) {
                        prompt.get(['two factor code'], (err, result) => {
                            if (err) {
                                return console.error(err);
                            }

                            return this.login({twofactorcode: result['two factor code']}, callback);
                        });
                    } else if (body.emailauth_needed) {
                        prompt.get(['email auth code'], (err, result) => {
                            if (err) {
                                return console.error(err);
                            }

                            return this.login({emailauth: result['email auth code']}, callback);
                        });
                    } else {
                        console.error('Login Error: ' + body.message);
                    }
                } else {
                    this.cookie = (<string[]>httpResponse.headers['set-cookie']).join(';');

                    return callback();
                }
            });
        });
    }
}


new Program().start();
