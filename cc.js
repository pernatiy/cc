// --- Calculator
function Calculator () {
    this.schema = [
        {
            objects: function () { return Game.UpgradesInStore.filter(function(e) { return (e.id != 69 && e.id != 71 && e.id != 73 && e.id != 85); }); },
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
        var base_cps = Game.cookiesPs;
        var res = list.map(function (e) {
            var cps, price = item.price(e);
            item.add(e);
            Game.CalculateGains();
            cps = Game.cookiesPs;
            item.sub(e);
            return [e, price, this.cps_acc(base_cps, cps, price)];
        }, this);
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
        var total = Game.BuildingsOwned + Game.UpgradesOwned;
        if (total != this.total || !this.actions.autobuy.id) {
            this.total = total;
            this.unqueue_action('buy');
        }
    },

    autobuy: function () {
        if (this.actions.timeouts.buy)
            return;

        var info = this.calc.find_best();
        info = { obj: info[0], price: info[1], acc: info[2] };

        var wait = 0.1 + (info.price - Game.cookies) / Game.cookiesPs;
        var msg = (wait < 0 ? 'Choosing' : 'Waiting (' + Beautify(wait, 1) + 's) for') + ' "' + info.obj.name + '" (acc: ' + Beautify(info.acc, 3) + ' cps^2)';

        this.say(msg);
        if (info.price < Game.cookies) {
            info.obj.buy();
            this.total++;
        } else {
            this.queue_action("buy", 1000 * wait, function () { info.obj.buy(); this.total++; }.bind(this));
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
        to[name] = setTimeout(function () { delete to[name]; func() }, delay);
    },
};

var ctrl = new Controller;
document.addEventListener('keydown', function (event) {
    var actions = {
        65 /* A */: 'autobuy',
        71 /* G */: 'gold',
        70 /* F */: 'frenzy',
        77 /* M */: 'main',
        83 /* S */: 'status',
    };
    ctrl.toggle_action(actions[event.keyCode]);
});
