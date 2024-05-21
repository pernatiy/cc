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
    cps_acc: function (base_cps, new_cps, price) { return (base_cps * base_cps) * (new_cps - base_cps) / (price * price); },
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
    this.calc    = new Calculator();
    this.notify  = new Audio("//github.com/pernatiy/cc/raw/master/beep-30.mp3");
    this.protect = true;
    this.target  = { name: undefined, price: -1 };
    this.total   = -1;

    this.actions = {
        timeouts: { },

        guard:   { delay: 1000, func: this.guard.bind(this) },
        autobuy: { delay:  250, func: this.autobuy.bind(this) },
        oneshot: { delay:    0, func: this.autobuy.bind(this) },
        status:  { delay:    0, func: this.status.bind(this) },
        protect: { delay:    0, func: this.toggle_protect.bind(this) },

        main:    { delay:   50, func: Game.ClickCookie },
        frenzy:  { delay:   50, func: function () {
            if (this.is_click_frenzy())
                Game.ClickCookie();
        }.bind(this) },
        season:  { delay: 1000, func: function () {
            const ss = Game.shimmers.filter(s => s.type != 'golden');
            if (ss.length > 0)
                ss[0].pop();
        } },
        gold:    { delay: 1000, func: function () {
            const gcs = Game.shimmers.filter(s => s.type == 'golden' && s.wrath == 0);
            if (gcs.length > 0)
                gcs[0].pop();
        } },
        gnotify: { delay: 1000, func: function () {
            const gcs = Game.shimmers.filter(s => s.type == 'golden' && s.wrath == 0);
            if (gcs.length > 0)
                this.notify.play();
        }.bind(this) },
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
        }
    },

    guard: function () {
        if (this.actions.timeouts.buy) {
            var t = this.total;
            this.total = 1000 * this.is_frenzy() + Game.BuildingsOwned + Game.UpgradesOwned;
            if (t != this.total || !this.actions.autobuy.id || this.target.price <= Game.cookies)
                this.unqueue_action('buy');
        }
    },

    autobuy: function () {
        if (this.actions.timeouts.buy || this.is_click_frenzy())
            return;

        var info = this.calc.find_best(this.actions.main.id ? 1000 / this.actions.main.delay : 0);
        var protect = this.protect ? (this.is_frenzy() ? 1 : 7) * Game.cookiesPs * 60*15/0.15 : 0;
        var wait = (protect + info.price - Game.cookies) / this.calc.ecps();
        var msg = (wait > 0 ? 'Waiting (' + Beautify(wait, 1) + ' s) for' : 'Choosing') + ' "' + info.obj.name + '"';
        console.log("For {cps = " + Beautify(Game.cookiesPs, 1) + ", protect = " + Beautify(protect) + "} best candidate is", info);

        this.say(msg);
        if (wait > 0) {
            this.target.name  = info.obj.name;
            this.target.price = protect + info.price;
            this.queue_action(
                'buy',
                1000 * (Game.cookiesPs ? wait + 0.05 : 60),
                function () { if (info.price <= Game.cookies) { this.say('Bought "' + info.obj.name + '"'); info.obj.buy(); this.total++; } }.bind(this)
            );
        } else {
            info.obj.buy();
            this.total++;
        }
    },

    status: function () {
        var act = [];
        var b2s = function (b) { return b ? 'on'.fontcolor('green') : 'off'.fontcolor('red'); };
        for (var i in this.actions)
            if (this.actions[i].delay && i != 'guard')
                act.push(i + ': ' + b2s(this.actions[i].id));
        var msg = '<p>' + act.join(', ') + '</p>';
        msg += '<p>cookie protection for max frenzy/lucky combo: ' + b2s(this.protect) + '</p>';
        if (this.actions.timeouts.buy)
            msg += '<p>waiting ' + Beautify((this.target.price - Game.cookies) / this.calc.ecps(), 1) + ' s for "' + this.target.name + '"</p>';
        this.say(msg, true);
    },

    // --- Helpers
    toggle_protect: function () { this.protect = !this.protect; this.unqueue_action('buy'); },

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

    unqueue_action: function (name) {
        var to = this.actions.timeouts;
        if (to[name]) {
            clearTimeout(to[name]);
            delete to[name];
        }
    },

    queue_action: function (name, delay, func) {
        var to = this.actions.timeouts;
        this.unqueue_action(name);
        to[name] = setTimeout(function () { func(); delete to[name]; }, delay);
    },

    is_frenzy: function () {
        return Object.values(Game.buffs).filter(b => b.type.name == "frenzy").length > 0;
    },

    is_click_frenzy: function () {
        return Object.values(Game.buffs).filter(b => b.type.name == "click frenzy").length > 0;
    },
};

var view = {
    ctrl: new Controller,
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
