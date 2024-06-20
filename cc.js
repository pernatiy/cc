(function() {

// --- Logger
const logger = {
    _log: (f, ...args) => {
        const now = (new Date()).toISOString();
        f(`[${now}]`, ...args);
    },

    log: (...args) => logger._log(console.log, ...args),
    warn: (...args) => logger._log(console.warn, ...args),
    error: (...args) => logger._log(console.error, ...args),
};

// --- Action Queue
function ActionQueue () {
    this._queue = {};
}

ActionQueue.prototype = {
    enqueue: function (name, time, action) {
        this.dequeue(name);
        this._queue[name] = setTimeout(() => {
            delete this._queue[name];
            action();
        }, time);
    },

    dequeue: function (name) {
        if (this._queue[name]) {
            clearTimeout(this._queue[name]);
            delete this._queue[name];
        }
    },

    is_enqueued: function (name) {
        return this._queue[name] ? true : false
    },

    clear: function () {
        for (let i in this._queue)
            this.dequeue(i);
    }
}

// --- Calculator
function Calculator () {
    this.zero_max_wait = 60 * 3; // 3 minutes
    this.threshold_fraction = 1/1000;
    this.upgrades_enabled = true;
    this.pools = [
        () => {
            return Game.UpgradesInStore.filter(u => this.upgrades_enabled && (u.pool == "" || u.pool == "cookie")).map(u => {
                return {
                    name: u.name,
                    price: u.basePrice,
                    obj: u,
                    icon: u.icon,
                    add: _ => u.bought = 1,
                    sub: _ => u.bought = 0,
                    buy: _ => u.buy(),
                };
            });
        },
        () => {
            return Game.ObjectsById.filter(o => o.locked == 0).map(o => {
                return {
                    name: o.name,
                    price: o.price,
                    obj: o,
                    icon: [o.iconColumn, 0],
                    add: _ => ++o.amount,
                    sub: _ => --o.amount,
                    buy: _ => { const c = o.amount; o.buy(1); return o.amount > c; },
                };
            });
        },
    ];
}

Calculator.prototype = {
    ecps: function (click_rate) {
        return Game.cookiesPs * (1 - Game.cpsSucked) + Game.computedMouseCps * click_rate;
    },

    metric: function (cur_cps, new_cps, price) {
        const adj_cur_cps = cur_cps === 0 ? 1e-6 : cur_cps;
        return ((new_cps - adj_cur_cps)/price)**2 * (1 - Math.exp(-adj_cur_cps/price));
    },

    calc_bonus: function (list, click_rate, price_adj) {
        const cur_cps = this.ecps(click_rate);

        const res = list.map(e => {
            e.add();
            Game.CalculateGains();
            const new_cps = this.ecps(click_rate);
            e.sub();
            return { item: e, metric: this.metric(cur_cps, new_cps, Math.max(1, e.price + price_adj)) };
        });
        Game.CalculateGains();

        return res;
    },

    find_best: function (click_rate = 0, price_adj = 0) {
        const g_win = Game.Win;
        const g_rawh = Game.cookiesPsRawHighest;
        Game.Win = function () { };

        let pool = [];
        for (let p of this.pools)
            pool = pool.concat(p());

        let options = this.calc_bonus(pool, click_rate, price_adj);

        Game.Win = g_win;
        Game.cookiesPsRawHighest = g_rawh;

        const zero_max_price = Game.cookiesPsRaw * this.zero_max_wait;

        if (options.length !== 0) {
            options.sort((a, b) => b.metric - a.metric);
            logger.log('options are', options);
        }

        // Step 1: Find the item with metric == 0 and lowest price
        const candidate_zero = options
            .filter(e => e.metric === 0)
            .reduce((l, e) => l === null || e.item.price < l.item.price ? e : l, null)
            ?.item;

        // Step 2: Find the item with highest metric
        const candidate_acc = options
            .reduce((best, e) => best === null || e.metric > best.metric ? e : best, null)
            ?.item;

        const cheap_price_threshold = candidate_acc ? candidate_acc.price * this.threshold_fraction : Infinity;

        // Step 3: Find the item with a highest non-zero metric and price lower than threshold
        const candidate_cheap = options
            .filter(e => e.metric > 0 && e.item.price < cheap_price_threshold)
            .reduce((best, e) => best === null || e.metric > best.metric ? e : best, null)
            ?.item;

        // Step 4: Choose one of the three items based on the rules
        if (candidate_zero && (candidate_zero.price < zero_max_price || candidate_acc === null)) {
            return candidate_zero;
        } else if (candidate_cheap) {
            return candidate_cheap;
        } else {
            return candidate_acc;
        }

        return null;
    }
};

// --- Controller
function Controller () {
    this._notification = new Audio("//github.com/pernatiy/cc/raw/master/beep-30.mp3");
    this._queue   = new ActionQueue();
    this._calc    = new Calculator();
    this._target  = null;
    this._env     = { control_sum: 0 };
    this._protect = {
        value: 0,
        if_value: 0,
        amount: _ => Game.cookiesPsRaw * this._protect.value * 60 / 0.15,
    };

    this.force_check_timeout = 10 * 60 * 1000; // 10 minutes

    this.actions = {
        status:  { delay: 0, func: () => { this.status(); } },
        oneshot: { delay: 0, func: () => {
            if (this._target) {
                this.say(this.get_wait_time_msg(true));
            } else {
                this.autobuy(true);
                this._target = null;
            }
        } },
        query:   { delay: 0, func: () => {
            const info = this._calc.find_best(this.get_click_rate(), this._protect.amount() - Game.cookies);
            if (info)
                this.notify('Purchase suggestion', info.name, info.icon);
            else
                this.notify('Purchase suggestion', 'Nothing to buy');
        } },
        protect: { delay: 0, func: () => {
            let m = this._protect.if_value;
            switch (m) {
                case   0: m =  15; break;
                case  15: m =  30; break;
                case  30: m = 105; break;
                case 105: m =   0; break;
            }
            this._protect.if_value = m;
            // delay actual change to allow user to put correct value that requires undergo via zero
            this._queue.enqueue('change_protect', 1000, () => { this._protect.value = m; });
            this.say(`Protect cookies worth ${m} min of production`);
        } },
        toggle_upgrades: { delay: 0, func: () => {
            this._calc.upgrades_enabled = !this._calc.upgrades_enabled;
            this.say(`Upgrades are ${this._calc.upgrades_enabled ? 'enabled' : 'disabled'} for autobuy`);
        } },

        autobuy: { delay: 250,
            func: () => { this.autobuy(); },
            on_trigger: (on) => { if (!on) this._target = null; }
        },

        main:    { delay: 50, func: Game.ClickCookie },
        frenzy:  { delay: 50, func: () => {
            if (this.is_click_frenzy())
                Game.ClickCookie();
        } },

        season:  { delay: 1000, func: () => {
            const ss = Game.shimmers.filter(s => s.type != 'golden');
            if (ss.length > 0)
                ss[0].pop();
        } },
        gold:    { delay: 1000, func: () => { this.gold_cookie_popper(); } },
        notify:  { delay: 1000, func: () => {
            const gcs = Game.shimmers.filter(s => s.type == 'golden' && s.wrath == 0);
            if (gcs.length > 0)
                this._notification.play();
        } },
    };

    this.say("Clicker Bot is here to help you!");
}

Controller.prototype = {
    say: function (msg) {
        logger.log(msg);
        Game.Popup(msg);
        this._queue.enqueue('clear_stack', 5000, () => { Game.textParticlesY = 60; });
    },

    say_news: function (msg) {
        logger.log(msg);
        Game.Ticker = msg;
        Game.TickerAge = 10 * Game.fps;
        Game.TickerDraw();
    },

    notify: function (title, msg, icon = [10, 0]) {
        logger.log(`${title}: ${msg}`);
        Game.Notify(title, msg, icon, 20, 1);
    },

    autobuy: function (force = false) {
        const free_cookies = Game.cookies - this._protect.amount();
        var price_adj = -free_cookies; // lower price by available to spend

        // 1. avoid buying during click frenzy
        if (!force && this.is_click_frenzy())
            return;

        // 2. purchase target if it's affordable
        if (this._target && this._target.item.price <= free_cookies)
            if (this.autobuy_exec())
                return;

        // 3. force check if number of buildings or autoclick was changed
        const t = this._env.control_sum;
        this._env.control_sum = 77 * !!this.actions.main.id +
            Game.BuildingsOwned + Game.UpgradesOwned;
        if (t != this._env.control_sum)
            force = true;

        // 4. force check once in a while
        if (this._target && Game.time - this._target.time > this.force_check_timeout)
            force = true;

        // 5. if not forced and already have a target - do nothing
        if (!force && this._target)
            return;

        // 6. if there was a target - use the same price adjustment
        if (this._target)
            price_adj = this._target.padj;

        const info = this._calc.find_best(this.get_click_rate(), price_adj);
        if (!info) return; // nothing to buy((

        const cps = this._calc.ecps(this.get_click_rate());
        logger.log(`For (bank, cps) = (${Beautify(free_cookies, 1)}, ${Beautify(cps, 1)}) best candidate is`, info);

        this._target = {
            item: info,
            time: Game.time,
            padj: price_adj,
        };

        if (info.price > free_cookies) {
            this.say(this.get_wait_time_msg(true));
        } else {
            this.autobuy_exec();
        }
    },

    autobuy_exec: function () {
        const info = this._target.item;

        const buy_mode = Game.buyMode;
        Game.buyMode = 1;
        let success = info.buy();
        Game.buyMode = buy_mode;

        if (success)
            this.notify("Auto Buy", info.name, info.icon);

        this._target = null;
        return success;
    },

    gold_cookie_popper: function () {
        const gcs = Game.shimmers.filter(s => s.type == 'golden' && s.wrath == 0);
        if (gcs.length > 0)
            gcs[0].pop();

        if (gcs.length > 1)
            this._queue.enqueue('clear_gc', 50, () => { this.gold_cookie_popper(); });
    },

    status: function () {
        const act = [];
        const b2s = function (b) { return b ? 'on'.fontcolor('green') : 'off'.fontcolor('red'); };
        for (let i in this.actions)
            if (this.actions[i].delay)
                act.push(i + ': ' + b2s(this.actions[i].id));
        let msg = '<p>' + act.join(', ') + '</p>';
        msg += '<p>protection: '+this._protect.value+' min ('+Beautify(this._protect.amount())+')</p>';
        if (this._target)
            msg += `<p>${this.get_wait_time_msg()}</p>`;
        this.say_news(msg);
    },

    toggle_action: function (name) {
        const action = this.actions[name];

        if (!action)
            return;

        if (action.delay) {
            action.id = action.id ? clearInterval(action.id) : setInterval(action.func, action.delay);
            this.say(`Action "${name}" turned ${action.id ? 'on' : 'off'}`);
            if (action.on_trigger)
                action.on_trigger(!!action.id);
        } else {
            action.func();
        }
    },

    shutdown: function () {
        for (let i in this.actions)
            if (this.actions[i].id)
                clearInterval(this.actions[i].id);

        this._queue.clear();
    },

    get_click_rate: function () {
        return this.actions.main.id ? 1000 / this.actions.main.delay : 0;
    },

    is_frenzy: function () {
        return Object.values(Game.buffs).filter(b => b.type.name == 'frenzy' || b.type.name == 'dragon harvest').length > 0;
    },

    is_click_frenzy: function () {
        return Object.values(Game.buffs).filter(b => b.type.name == 'click frenzy' || b.type.name == 'dragonflight').length > 0;
    },

    get_wait_time_msg: function (cap = false) {
        const t = (this._protect.amount() + this._target.item.price - Game.cookies) / this._calc.ecps(this.get_click_rate());
        return `${cap ? 'W' : 'w'}aiting ${Beautify(t, 1)} sec for "${this._target.item.name}"`;
    },
};

const view = {
    ctrl: new Controller(),
    actions: {
        0x51 /* Q */: 'query',
        0x41 /* A */: 'autobuy',
        0x5a /* Z */: 'oneshot',
        0x48 /* H */: 'season',
        0x47 /* G */: 'gold',
        0x4e /* N */: 'notify',
        0x46 /* F */: 'frenzy',
        0x4d /* M */: 'main',
        0x53 /* S */: 'status',
        0x50 /* P */: 'protect',
        0x55 /* U */: 'toggle_upgrades',
    },
};

if (typeof window.view === 'undefined') {
    document.addEventListener('keydown', function (e) {
        if (view.actions[e.keyCode])
            view.ctrl.toggle_action(view.actions[e.keyCode]);
    });
    window.view = view;
} else {
    window.view.ctrl.shutdown();
    window.view.ctrl = view.ctrl;
}

})();
