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
}

// --- Calculator
function Calculator () {
    this.upgrades_enabled = true;
    this.pools = [
        function () {
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
        function () {
            return Game.ObjectsById.filter(o => o.locked == 0).map(o => {
                return {
                    name: o.name,
                    price: o.price,
                    obj: o,
                    icon: [o.iconColumn, 0],
                    add: _ => ++o.amount,
                    sub: _ => --o.amount,
                    buy: _ => { var c = o.amount; o.buy(1); return o.amount > c; },
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

    calc_bonus: function (generator, click_rate) {
        var cur_cps = this.ecps(click_rate);

        var res = generator().map(e => {
            e.add();
            Game.CalculateGains();
            var new_cps = this.ecps(click_rate);
            e.sub();
            return { item: e, metric: this.metric(cur_cps, new_cps, e.price) };
        });
        Game.CalculateGains();

        return res;
    },

    find_best: function (click_rate) {
        const g_win = Game.Win;
        const g_rawh = Game.cookiesPsRawHighest;
        Game.Win = function () { };

        var pool = [];
        for (var p of this.pools)
            pool = pool.concat(this.calc_bonus(p, click_rate || 0));

        Game.Win = g_win;
        Game.cookiesPsRawHighest = g_rawh;

        // separate zero-production items from the rest
        const [zeroes, accs] = pool.reduce((r, e) => {
            if (e.metric === 0)
                r[0].push(e);
            else
                r[1].push(e);
            return r;
        }, [[], []]);

        // find the cheapest zero-production item and the most efficient one
        const zero_candidate = zeroes.reduce((r, e) => r.item.price < e.item.price ? r : e, zeroes[0]);
        const acc_candidate = accs.reduce((r, e) => r.metric < e.metric ? e : r, accs[0]);

        // prefer non-acceleration items only if they are cheaper than 3 minute of production or there are no accelerators
        if (zero_candidate?.item.price < Game.cookiesPsRaw * 3*60 || acc_candidate === undefined)
            return zero_candidate?.item;
        else
            return acc_candidate.item;
    }
};

// --- Controller
function Controller () {
    this._notification = new Audio("//github.com/pernatiy/cc/raw/master/beep-30.mp3");
    this._queue   = new ActionQueue();
    this._calc    = new Calculator();
    this._protect = { amount: _ => 0, time: 0 };
    this._target  = null;
    this._guard   = { total: 0, cps: 0 };

    this.actions = {
        guard:   { delay: 1000, func: () => { this.guard(); } },

        oneshot: { delay:    0, func: () => { this.autobuy(true); this._target = null; } },
        status:  { delay:    0, func: () => { this.status(); } },
        query:   { delay:    0, func: () => {
            var info = this._calc.find_best(this.get_click_rate());
            this.notify('Purchase suggestion', info.name, info.icon);
        } },
        protect: { delay:    0, func: () => {
            var m = this._protect.time;
            switch (m) {
                case   0: m =  15; break;
                case  15: m =  30; break;
                case  30: m = 105; break;
                case 105: m =   0; break;
            }
            this._protect.time = m;
            this._protect.amount = _ => Game.cookiesPsRaw * m*60 / 0.15;
            this.say('Protect cookies worth ' + m + 'min of production');
        } },
        toggle_upgrades: { delay: 0, func: () => {
            this._calc.upgrades_enabled = !this._calc.upgrades_enabled;
            this.say('Upgrades are ' + (this._calc.upgrades_enabled ? 'enabled' : 'disabled') + ' for autobuy');
        } },

        autobuy: { delay:  250,
            func: () => { this.autobuy(); },
            on_trigger: (on) => { if (!on) this._target = null; }
        },

        main:    { delay:   50, func: Game.ClickCookie },
        frenzy:  { delay:   50, func: () => {
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
        console.log(msg);
        Game.Popup(msg);
        this._queue.enqueue('clear_stack', 5000, () => { Game.textParticlesY = 60; });
    },

    say_news: function (msg) {
        console.log(msg);
        Game.Ticker = msg;
        Game.TickerAge = 10 * Game.fps;
        Game.TickerDraw();
    },

    notify: function (title, msg, icon = [10, 0]) {
        console.log(title + ": " + msg);
        Game.Notify(title, msg, icon, 20, 1);
    },

    guard: function () { },

    autobuy: function (force = false) {
        // 1. purchase target if it's affordable
        if (this._target && this._protect.amount() + this._target.price < Game.cookies)
            if (this.autobuy_exec())
                return;

        // 2. force check if number of buildings or cps was changed externally
        var t_ = this._guard.total;
        var c_ = this._guard.cps;
        this._guard.total = this.get_guard_total();
        this._guard.cps = Game.cookiesPs;
        if (t_ != this._guard.total || c_ != this._guard.cps)
            force = true;

        // 3. if not forced and already have a target - do nothing
        if (!force && this._target)
            return;

        // 4. also avoid buying during click frenzy
        if (!force && this.is_click_frenzy())
            return;

        var info = this._target = this._calc.find_best(this.get_click_rate());
        if (!info) return; // nothing to buy((

        var cps = this._calc.ecps(this.get_click_rate());
        var cookie_delta = this._protect.amount() + info.price - Game.cookies;
        console.log("For ecps = " + Beautify(cps, 1) + " best candidate is " + info.name + " =>", info);

        if (cookie_delta > 0) {
            this.say('Waiting ' + Beautify(cookie_delta/cps, 1) + 's for "' + info.name + '"');
        } else {
            this.autobuy_exec();
        }
    },

    autobuy_exec: function () {
        var success = false;
        var info = this._target;
        var buy_mode = Game.buyMode;
        Game.buyMode = 1;
        if (info.buy()) {
            ++this._total;
            success = true;
            this.notify("autobuy", info.name, info.icon);
        }
        Game.buyMode = buy_mode;
        this._target = null;
        return success;
    },

    gold_cookie_popper: function () {
        var gcs = Game.shimmers.filter(s => s.type == 'golden' && s.wrath == 0);
        if (gcs.length > 0)
            gcs[0].pop();

        if (gcs.length > 1)
            this._queue.enqueue('clear_gc', 50, () => { this.gold_cookie_popper(); });
    },

    status: function () {
        var act = [];
        var b2s = function (b) { return b ? 'on'.fontcolor('green') : 'off'.fontcolor('red'); };
        for (var i in this.actions)
            if (this.actions[i].delay && i != 'guard')
                act.push(i + ': ' + b2s(this.actions[i].id));
        var msg = '<p>' + act.join(', ') + '</p>';
        msg += '<p>protection: '+this._protect.time+'min ('+Beautify(this._protect.amount())+')</p>';
        if (this._target)
            msg += '<p>waiting ' + Beautify(this.get_wait_time()) + 's for "' + this._target.name + '"</p>';
        this.say_news(msg);
    },

    toggle_action: function (name) {
        var action = this.actions[name];

        if (!action)
            return;

        if (action.delay) {
            action.id = action.id ? clearInterval(action.id) : setInterval(action.func, action.delay);
            this.say('Action "' + name + '" turned ' + (action.id ? 'on' : 'off'));
            if (action.on_trigger)
                action.on_trigger(!!action.id);
        } else {
            action.func();
        }
    },

    get_click_rate: function () {
        return this.actions.main.id ? 1000 / this.actions.main.delay : 0;
    },

    is_frenzy: function () {
        return Object.values(Game.buffs).filter(b => b.type.name == "frenzy").length > 0;
    },

    is_click_frenzy: function () {
        return Object.values(Game.buffs).filter(b => b.type.name == "click frenzy").length > 0;
    },

    get_guard_total: function () {
        return 10 * !!this.actions.main.id +
            Game.BuildingsOwned + Game.UpgradesOwned;
    },

    get_wait_time: function () {
        return this._target
            ? (this._protect.amount() + this._target.price - Game.cookies) / this._calc.ecps(this.get_click_rate())
            : 0;
    }
};

var view = {
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
document.addEventListener('keydown', function (e) { if (this.actions[e.keyCode]) this.ctrl.toggle_action(this.actions[e.keyCode]); }.bind(view));
