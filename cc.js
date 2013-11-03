// --- Calculator
function Calculator () {
    this.schema = [
        {
            objects: function () { return Game.UpgradesInStore.filter(function(e) { return ([69, 71, 73, 74, 84, 85, 87].indexOf(e.id) < 0); }); },
            accessors: {
                add:   function (e) { e.toggle(); },
                sub:   function (e) { e.toggle(); },
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
    cps_acc: function (base_cps, new_cps, price) { return base_cps * (new_cps - base_cps) / (price * price); },
    /*
    cps_acc: function (base_cps, new_cps, price) { return            (new_cps - base_cps) / (price * new_cps); },
    */
    calc_bonus: function (item, list) {
        var func = Game.Win;
        Game.Win = function () { };
        var res = list.map(function (e) {
            var cps, price = this.item.price(e);
            this.item.add(e);
            Game.CalculateGains();
            cps = Game.cookiesPs;
            this.item.sub(e);
            return [e, price, this.cps_acc(this.base_cps, cps, price)];
        }.bind({ item: item, base_cps: Game.cookiesPs ? Game.cookiesPs : 0.001, cps_acc: this.cps_acc }));
        Game.Win = func;
        Game.CalculateGains();
        return res;
    },

    find_best: function () {
        var pool = [];
        for (i = 0; i < this.schema.length; i++)
            pool = pool.concat(this.calc_bonus(this.schema[i].accessors, this.schema[i].objects()));
        return pool.reduce(function (m, v) { return m[2] > v[2] ? m : v; }, pool[0]);
    }
};

// --- Controller
function Controller () {
    this.calc = new Calculator();
    this.actions = {
        timeouts: { },

        guard:   { delay: 1000, func: this.guard.bind(this) },
        autobuy: { delay:  250, func: this.autobuy.bind(this) },
        oneshot: { delay:    0, func: this.autobuy.bind(this) },
        status:  { delay:    0, func: this.status.bind(this) },

        main:    { delay:   50, func: Game.ClickCookie },
        frenzy:  { delay:   50, func: function () { if (Game.clickFrenzy > 0) Game.ClickCookie(); } },
        gold:    { delay: 3000, func: function () { if (Game.goldenCookie.life > 0 && Game.goldenCookie.wrath == 0) Game.goldenCookie.click(); } },
    };

    this.toggle_action('guard');
}

Controller.prototype = {
    say: function (msg, news) {
        console.log(msg);
        if (news) {
            Game.Ticker = msg;
            Game.TickerAge = 10 * Game.fps;
        } else {
            Game.Popup(msg);
        }
    },

    guard: function () {
        var total = 1000 * (Game.frenzy > 0) + Math.floor(Game.cookieClicks/10) + Game.BuildingsOwned + Game.UpgradesOwned;
        if (total != this.total || !this.actions.autobuy.id) {
            this.total = total;
            this.unqueue_action('buy');
        }
    },

    autobuy: function () {
        if (this.actions.timeouts.buy || Game.clickFrenzy > 0)
            return;

        var info = this.calc.find_best();
        info = { obj: info[0], price: info[1] };

        var protect = Game.Has('Get lucky') ? (Game.frenzy ? 1 : 7) * Game.cookiesPs * 12000 : 0;
        var wait = (protect + info.price - Game.cookies) / Game.cookiesPs;
        var msg = (wait > 0 ? 'Waiting (' + Beautify(wait, 1) + 's) for' : 'Choosing') + ' "' + info.obj.name + '"';

        this.say(msg);
        if (wait > 0) {
            this.queue_action(
                "buy",
                1000 * (Game.cookiesPs ? wait + 0.05 : 3),
                function () { if (info.price <= Game.cookies) { this.say('Choosing "' + info.obj.name + '"'); info.obj.buy(); this.total++; } }.bind(this)
            );
        } else {
            info.obj.buy();
            this.total++;
        }
    },

    status: function () {
        var msg = '';
        for (i in this.actions)
            if (this.actions[i].delay)
                msg += i + ': ' + (this.actions[i].id ? 'on' : 'off') + '; ';
        this.say(msg, true);
    },

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
};

var view = {
    ctrl: new Controller,
    actions: {
        65 /* A */: 'autobuy',
        90 /* Z */: 'oneshot',
        71 /* G */: 'gold',
        70 /* F */: 'frenzy',
        77 /* M */: 'main',
        83 /* S */: 'status',
    },
};
document.addEventListener('keydown', function (e) { if (this.actions[e.keyCode]) this.ctrl.toggle_action(this.actions[e.keyCode]); }.bind(view));
