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

Calculator.prototype.cps_acc = function (base_cps, new_cps, price) { return base_cps * (new_cps - base_cps) / price; };

Calculator.prototype.calc_bonus = function (item, list) {
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
};

Calculator.prototype.find_best = function () {
    var pool = [];
    for (i = 0; i < this.schema.length; i++)
        pool = pool.concat(this.calc_bonus(this.schema[i].accessors, this.schema[i].objects()));
    return pool.reduce(function(m, v) { return m[2] > v[2] ? m : v; }, pool[0]);
};

// --- Controller
function Controller () {
    this.calc = new Calculator();
    this.actions = {
        timeouts: { },
        guard:  { delay: 1000, func: function () { this.buy(); }.bind(this) },
        gold:   { delay: 3000, func: function () { if (Game.goldenCookie.life > 0 && Game.goldenCookie.wrath == 0) Game.goldenCookie.click(); } },
        main:   { delay:   50, func: Game.ClickCookie },
        frenzy: { delay:   50, func: function () { if (Game.clickFrenzy > 0) Game.ClickCookie(); } },
    };
}

Controller.prototype.say = function (msg, news) {
    console.log(msg);
    if (news) {
        Game.Ticker = msg;
        Game.TickerAge = 10 * Game.fps;
    } else {
        Game.Popup(msg);
    }
};

Controller.prototype.buy = function () {
    if (this.actions.timeouts.buy)
        return;

    var info = this.calc.find_best();
    var obj   = info[0];
    var price = info[1];
    var acc   = info[2];

    var wait = (price - Game.cookies) / Game.cookiesPs;
    var msg = (wait < 0 ? 'Choosing' : 'Waiting (' + Beautify(wait, 1) + ') for') + ' "' + obj.name + '" (acc: ' + Beautify(acc, 3) + ' cps^2)';

    this.say(msg);
    if (price < Game.cookies)
        obj.buy();
    else
        this.queue_action("buy", 1000 * wait, function () { obj.buy(); });
};

Controller.prototype.toggle_action = function (name) {
    var action = this.actions[name];
    action.id = action.id ? clearInterval(action.id) : setInterval(action.func, action.delay);
    this.say('Action "' + name + '" turned ' + (action.id ? 'on' : 'off'));
};

Controller.prototype.unqueue_action = function (name) {
    var to = this.actions.timeouts;
    if (to[name]) clearTimeout(to[name]);
    delete to[name];
};

Controller.prototype.queue_action = function (name, delay, func) {
    var to = this.actions.timeouts;
    this.unqueue_action(name);
    to[name] = setTimeout(function () { delete to[name]; func() }, delay);
};

var ctrl = new Controller;
document.addEventListener('keydown', function(event) { if(event.keyCode == 65 /* A */) ctrl.toggle_action('guard');  });
document.addEventListener('keydown', function(event) { if(event.keyCode == 71 /* G */) ctrl.toggle_action('gold');   });
document.addEventListener('keydown', function(event) { if(event.keyCode == 70 /* F */) ctrl.toggle_action('frenzy'); });
