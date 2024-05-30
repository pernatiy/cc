// --- Action Queue
function ActionQueue () {
    this._queue = {};

    this.enqueue = (name, time, action) => {
        this.dequeue(name);
        this._queue[name] = setTimeout(action, time);
    };

    this.dequeue = (name) => {
        if (this._queue[name]) {
            clearTimeout(this._queue[name]);
            delete this._queue[name];
        }
    };

    this.is_enqueued = (name) => this._queue[name] ? true : false;
}

// --- Calculator
function Calculator () {
    this.schema = [
        {
            objects: function () {
                return Game.UpgradesInStore.filter(u => u.pool == "" || u.pool == "cookie")
            },
            accessors: {
                add:   function (e) { e.bought = 1; },
                sub:   function (e) { e.bought = 0; },
                price: function (e) { return e.basePrice; }
            }
        },
        {
            objects: function () { return Game.ObjectsById; },
            accessors: {
                add:   function (e) { e.amount++; },
                sub:   function (e) { e.amount--; },
                price: function (e) { return e.price; }
            }
        }
    ];
}

Calculator.prototype = {
    cps_acc: function (base_cps, new_cps, price) { return ((new_cps - base_cps)/price)**2 * (1 - Math.exp(-base_cps/price)); },
    ecps: function () { return Game.cookiesPs * (1 - Game.cpsSucked) },

    calc_bonus: function (item, list_generator, mouse_rate) {
        var func = Game.Win;
        Game.Win = function () { };

        var res = list_generator().map(function (e) {
            var price = Math.round(this.item.price(e));
            this.item.add(e); Game.CalculateGains();
            var cps = this.calc.ecps() + Game.computedMouseCps * this.rate;
            this.item.sub(e); Game.CalculateGains();
            return { obj: e, price: price, acc: this.calc.cps_acc(this.base_cps, cps, price) };
        }.bind({
            item: item,
            calc: this,
            rate: mouse_rate,
            base_cps: (Game.cookiesPs ? this.ecps() : 0.001) + Game.computedMouseCps * mouse_rate,
        }));

        Game.Win = func;
        return res;
    },

    find_best: function (mouse_rate) {
        var pool = [];
        var zero_buy = Math.sqrt(Game.cookiesEarned * Game.cookiesPs);
        for (var i = 0; i < this.schema.length; i++)
            pool = pool.concat(this.calc_bonus(this.schema[i].accessors, this.schema[i].objects, mouse_rate || 0));
        return pool.reduce(function (m, v) { return m.acc == 0 && m.price < zero_buy ? m : (v.acc == 0 && v.price < zero_buy ? v : (m.acc < v.acc ? v : m)); }, pool[0]);
    }
};

// --- Controller
function Controller () {
    this._notification = new Audio("//github.com/pernatiy/cc/raw/master/beep-30.mp3");
    this._queue   = new ActionQueue();
    this._calc    = new Calculator();
    this._protect = true;
    this._target  = { name: undefined, price: -1 };
    this._total   = -1;
    this._say     = { };

    this.actions = {
        guard:   { delay: 1000, func: () => { this.guard();   } },
        autobuy: { delay:  250, func: () => { this.autobuy(); } },
        oneshot: { delay:    0, func: () => { this.autobuy(); } },
        status:  { delay:    0, func: () => { this.status();  } },
        protect: { delay:    0, func: () => {
            this._protect = !this._protect;
            this._queue.dequeue('buy');
            this.say('Cookie protection turned ' + (this._protect ? 'on' : 'off'));
        } },

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

    this.toggle_action('guard');
}

Controller.prototype = {
    say: function (msg, news) {
        console.log(msg);
        if (news) {
            Game.Ticker = msg;
            Game.TickerAge = 10 * Game.fps;
            Game.TickerDraw();
        } else {
            Game.Popup(msg);
            this._queue.enqueue('clear_stack', 5000, () => { Game.textParticlesY = 60; });
        }
    },

    guard: function () {
        if (this._queue.is_enqueued('buy')) {
            var t = this._total;
            this._total = 1000 * this.is_frenzy() + Game.BuildingsOwned + Game.UpgradesOwned;
            if (t != this._total || !this.actions.autobuy.id || this._target.price <= Game.cookies)
                this._queue.dequeue('buy');
        }
    },

    autobuy: function () {
        if (this._queue.is_enqueued('buy') || this.is_click_frenzy())
            return;

        var mouse_rate = this.actions.main.id ? 1000 / this.actions.autobuy.delay : 0;
        var info = this._calc.find_best(mouse_rate);
        var protect = this._protect ? (this.is_frenzy() ? 1 : 7) * Game.cookiesPs * 60*15/0.15 : 0;
        var cookie_delta = protect + info.price - Game.cookies;
        console.log("For cps = " + Beautify(Game.cookiesPs, 1) + " (protect = " + Beautify(protect) + ") best candidate is " + info.obj.name + " =>", info);

        var buy = () => {
            if (info.price <= Game.cookies) {
                var buy_mode = Game.buyMode;
                Game.buyMode = 1; // we are here to buy, not to sell
                info.obj.buy();
                Game.buyMode = buy_mode;
                this._total++;
                console.log('Bought "' + info.obj.name + '"');
                Game.Notify("autobuy", info.obj.name, [10, 0], 20, 1);
            }
        }

        if (cookie_delta > 0) {
            var cps = this._calc.ecps() + Game.computedMouseCps * mouse_rate;
            var wait = Game.cookiesPs ? cookie_delta/cps : 60;
            this.say('Waiting ' + Beautify(wait, 1) + 's for "' + info.obj.name + '"');
            this._target.name  = info.obj.name;
            this._target.price = protect + info.price;
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
            msg += '<p>waiting ' + Beautify((this._target.price - Game.cookies) / this._calc.ecps(), 1) + ' s for "' + this._target.name + '"</p>';
        this.say(msg, true);
    },

    // --- Helpers
    toggle_action: function (name) {
        var action = this.actions[name];

        if (!action)
            return;

        if (action.delay) {
            action.id = action.id ? clearInterval(action.id) : setInterval(action.func, action.delay);
            this.say('Action "' + name + '" turned ' + (action.id ? 'on' : 'off'));
        } else {
            action.func();
        }
    },

    is_frenzy: function () {
        return Object.values(Game.buffs).filter(b => b.type.name == "frenzy").length > 0;
    },

    is_click_frenzy: function () {
        return Object.values(Game.buffs).filter(b => b.type.name == "click frenzy").length > 0;
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
