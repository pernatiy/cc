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
    this.pools = [
        function () {
            return Game.UpgradesInStore.filter(u => u.pool == "" || u.pool == "cookie").map(u => {
                return {
                    name: u.name,
                    price: u.basePrice,
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

        // buy useless item only if it way cheaper than the best one
        if (zero_candidate?.item.price < acc_candidate?.item.price/10)
            return zero_candidate?.item;
        else
            return acc_candidate?.item;
    }
};

// --- Controller
function Controller () {
    this._notification = new Audio("//github.com/pernatiy/cc/raw/master/beep-30.mp3");
    this._queue   = new ActionQueue();
    this._calc    = new Calculator();
    this._protect = false;
    this._target  = { name: undefined, cookies: -1 };

    this.actions = {
        guard:   { delay: 1000, func: () => { this.guard(); } },

        oneshot: { delay:    0, func: () => { this.autobuy(true); } },
        status:  { delay:    0, func: () => { this.status(); } },
        protect: { delay:    0, func: () => {
            this._protect = !this._protect;
            this._queue.dequeue('buy');
            this.say('Cookie protection turned ' + (this._protect ? 'on' : 'off'));
        } },

        autobuy: { delay:  250, func: () => { this.autobuy(); }, on_trigger: () => { this._queue.dequeue('buy'); }, },

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
        gold:    { delay: 1000, func: () => {
            const gcs = Game.shimmers.filter(s => s.type == 'golden' && s.wrath == 0);
            if (gcs.length > 0)
                gcs[0].pop();
        } },
        gnotify: { delay: 1000, func: () => {
            const gcs = Game.shimmers.filter(s => s.type == 'golden' && s.wrath == 0);
            if (gcs.length > 0)
                this._notification.play();
        } },
    };

    this._total = this.get_guard_total();

    this.toggle_action('guard');
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

    guard: function () {
        if (this._queue.is_enqueued('buy')) {
            var t = this._total;
            this._total = this.get_guard_total();
            if (t != this._total || !this.actions.autobuy.id || this._target.cookies <= Game.cookies)
                this._queue.dequeue('buy');
        }
    },

    autobuy: function (force = false) {
        if (!force && (this._queue.is_enqueued('buy') || this.is_click_frenzy()))
            return;

        var info = this._calc.find_best(this.get_click_rate());
        var protect = this._protect ? Game.cookiesPs * 60*15/0.15 : 0;
        var cookie_delta = protect + info.price - Game.cookies;
        console.log("For cps = " + Beautify(Game.cookiesPs, 1) + " (protect = " + Beautify(protect) + ") best candidate is " + info.name + " =>", info);

        var buy = _ => {
            var buy_mode = Game.buyMode;
            Game.buyMode = 1;
            if (info.buy()) {
                this._total++;
                this.notify("autobuy", info.name, info.icon);
            }
            Game.buyMode = buy_mode;
        }

        if (cookie_delta > 0) {
            var cps = this._calc.ecps(this.get_click_rate());
            var wait = cps > 0 ? cookie_delta/cps : 15;
            this.say('Waiting ' + Beautify(wait, 1) + 's for "' + info.name + '"');
            this._target.name    = info.name;
            this._target.cookies = protect + info.price;
            this._queue.enqueue('buy', 1000 * wait, buy);
        } else {
            buy();
        }
    },

    status: function () {
        var act = [];
        var b2s = function (b) { return b ? 'on'.fontcolor('green') : 'off'.fontcolor('red'); };
        for (var i in this.actions)
            if (this.actions[i].delay && i != 'guard')
                act.push(i + ': ' + b2s(this.actions[i].id));
        var msg = '<p>' + act.join(', ') + '</p>';
        msg += '<p>cookie protection for max frenzy/lucky combo: ' + b2s(this._protect) + '</p>';
        if (this._queue.is_enqueued('buy'))
            msg += '<p>waiting ' + Beautify((this._target.cookies - Game.cookies) / this._calc.ecps(this.get_click_rate()), 1) + ' s for "' + this._target.name + '"</p>';
        this.say_news(msg);
    },

    // --- Helpers
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
            10 * this.is_frenzy() +
            Game.BuildingsOwned + Game.UpgradesOwned;
    },
};

var view = {
    ctrl: new Controller(),
    actions: {
        65 /* A */: 'autobuy',
        90 /* Z */: 'oneshot',
        72 /* H */: 'season',
        71 /* G */: 'gold',
        78 /* N */: 'gnotify',
        70 /* F */: 'frenzy',
        77 /* M */: 'main',
        83 /* S */: 'status',
        80 /* P */: 'protect',
    },
};
document.addEventListener('keydown', function (e) { if (this.actions[e.keyCode]) this.ctrl.toggle_action(this.actions[e.keyCode]); }.bind(view));
