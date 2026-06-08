(function () {
  const app = angular.module('musicStoreApp', ['ngRoute']);

  app.config(function ($routeProvider, $httpProvider) {
    $routeProvider
      .when('/login', { template: loginTemplate(), controller: 'AuthController', controllerAs: 'auth' })
      .when('/home', { template: homeTemplate(), controller: 'HomeController', controllerAs: 'home' })
      .when('/products', { template: productsTemplate(), controller: 'ProductsController', controllerAs: 'products' })
      .when('/products/:id', { template: productDetailsTemplate(), controller: 'ProductDetailsController', controllerAs: 'detail' })
      .when('/cart', { template: cartTemplate(), controller: 'CartController', controllerAs: 'cart' })
      .when('/checkout', { template: checkoutTemplate(), controller: 'CheckoutController', controllerAs: 'checkout' })
      .when('/confirmation/:id', { template: confirmationTemplate(), controller: 'ConfirmationController', controllerAs: 'confirm' })
      .when('/profile', { template: profileTemplate(), controller: 'ProfileController', controllerAs: 'profile' })
      .when('/dashboard', { template: dashboardTemplate(), controller: 'DashboardController', controllerAs: 'dash' })
      .when('/inventory', { template: inventoryTemplate(), controller: 'InventoryController', controllerAs: 'inventory' })
      .when('/sales', { template: salesTemplate(), controller: 'SalesController', controllerAs: 'sales' })
      .when('/store', { redirectTo: '/products' })
      .otherwise({ redirectTo: '/home' });

    $httpProvider.interceptors.push(function () {
      return {
        request(config) {
          const token = localStorage.getItem('musicStoreToken');
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
          return config;
        }
      };
    });
  });

  app.factory('Api', function ($http) {
    return {
      login: (payload) => $http.post('/api/auth/login', payload),
      register: (payload) => $http.post('/api/auth/register', payload),
      dashboard: () => $http.get('/api/dashboard'),
      products: () => $http.get('/api/products'),
      product: (id) => $http.get(`/api/products/${id}`),
      addProduct: (payload) => $http.post('/api/products', payload),
      updateProduct: (product) => $http.put(`/api/products/${product.id}`, product),
      sales: () => $http.get('/api/sales'),
      recordSale: (payload) => $http.post('/api/sales', payload),
      checkout: (payload) => $http.post('/api/checkout', payload),
      myOrders: () => $http.get('/api/orders/my'),
      customers: () => $http.get('/api/customers'),
      orders: () => $http.get('/api/orders'),
      activity: () => $http.get('/api/activity')
    };
  });

  app.factory('Auth', function ($location) {
    const service = {
      user: JSON.parse(localStorage.getItem('musicStoreUser') || 'null'),
      setSession(response) {
        localStorage.setItem('musicStoreToken', response.data.token);
        localStorage.setItem('musicStoreUser', JSON.stringify(response.data.user));
        service.user = response.data.user;
      },
      logout() {
        localStorage.removeItem('musicStoreToken');
        localStorage.removeItem('musicStoreUser');
        service.user = null;
        $location.path('/home');
      },
      isAdmin() {
        return service.user && ['admin', 'employee'].includes(service.user.role);
      }
    };
    return service;
  });

  app.factory('Cart', function ($rootScope) {
    const storageKey = 'musicStoreCart';
    const items = JSON.parse(localStorage.getItem(storageKey) || '[]');

    function save() {
      localStorage.setItem(storageKey, JSON.stringify(items));
      $rootScope.$broadcast('cart:changed');
    }

    return {
      items,
      add(product, quantity) {
        const amount = Number(quantity || 1);
        const existing = items.find((item) => item.productId === product.id);
        if (existing) {
          existing.quantity += amount;
        } else {
          items.push({
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: amount,
            image: product.image,
            stock: product.quantity
          });
        }
        save();
      },
      update(productId, quantity) {
        const item = items.find((entry) => entry.productId === productId);
        if (item) {
          item.quantity = Math.max(1, Number(quantity || 1));
          save();
        }
      },
      remove(productId) {
        const index = items.findIndex((item) => item.productId === productId);
        if (index >= 0) {
          items.splice(index, 1);
          save();
        }
      },
      clear() {
        items.splice(0, items.length);
        save();
      },
      count() {
        return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      },
      total() {
        return items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
      }
    };
  });

  app.directive('vinylPlayer', function () {
    return {
      restrict: 'E',
      scope: { product: '=' },
      template: `
        <div class="vinyl-stage" ng-class="{ playing: playing }">
          <button class="vinyl-disc" type="button" ng-click="toggle()" aria-label="Toggle audio preview">
            <span class="vinyl-label"><i class="bi" ng-class="playing ? 'bi-pause-fill' : 'bi-play-fill'"></i></span>
          </button>
          <div class="tonearm"></div>
          <div class="player-copy">
            <strong>{{ product.spotifyPreviewUrl && !fallbackMode ? 'Preview ready' : 'Studio tone preview' }}</strong>
            <span>{{ statusText }}</span>
          </div>
          <audio preload="metadata"></audio>
        </div>`,
      link(scope, element) {
        const audio = element.find('audio')[0];
        let synth = null;
        scope.statusText = 'Press the record to listen';
        scope.fallbackMode = false;

        if (scope.product && scope.product.spotifyPreviewUrl) {
          audio.crossOrigin = 'anonymous';
          audio.src = scope.product.spotifyPreviewUrl;
        }

        scope.toggle = function () {
          if (scope.playing) {
            stopPreview();
            return;
          }

          if (audio.src && !scope.fallbackMode) {
            audio.currentTime = 0;
            audio.play().catch(() => {
              startSynthPreview();
            });
          } else {
            startSynthPreview();
          }
        };

        function startSynthPreview() {
          stopAudioOnly();
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) {
            scope.$applyAsync(() => {
              scope.playing = false;
              scope.statusText = 'Audio preview is not supported by this browser';
            });
            return;
          }

          const context = new AudioContext();
          const gain = context.createGain();
          const notes = tonePattern(scope.product && scope.product.category);
          let step = 0;
          gain.gain.value = 0.08;
          gain.connect(context.destination);

          synth = {
            context,
            gain,
            timer: setInterval(() => {
              const oscillator = context.createOscillator();
              oscillator.type = 'triangle';
              oscillator.frequency.value = notes[step % notes.length];
              oscillator.connect(gain);
              oscillator.start();
              oscillator.stop(context.currentTime + 0.28);
              step += 1;
            }, 320)
          };

          scope.$applyAsync(() => {
            scope.fallbackMode = true;
            scope.playing = true;
            scope.statusText = 'Playing a local studio tone preview';
          });
        }

        function tonePattern(category) {
          if (category === 'Album') {
            return [196, 247, 294, 330, 294, 247];
          }
          if (category === 'Accessory') {
            return [110, 147, 165, 196, 165, 147];
          }
          return [147, 196, 247, 294, 247, 196];
        }

        function stopAudioOnly() {
          if (!audio.paused) {
            audio.pause();
          }
        }

        function stopPreview() {
          stopAudioOnly();
          if (synth) {
            clearInterval(synth.timer);
            synth.gain.disconnect();
            synth.context.close();
            synth = null;
          }
          scope.playing = false;
          scope.statusText = 'Press the record to listen';
        }

        audio.addEventListener('play', () => scope.$applyAsync(() => {
          scope.playing = true;
          scope.fallbackMode = false;
          scope.statusText = 'Spinning with the audio preview';
        }));
        audio.addEventListener('pause', () => scope.$applyAsync(() => {
          if (!synth) {
            scope.playing = false;
            scope.statusText = 'Press the record to listen';
          }
        }));
        audio.addEventListener('ended', () => scope.$applyAsync(stopPreview));
        audio.addEventListener('error', () => scope.$applyAsync(() => {
          scope.fallbackMode = true;
          scope.statusText = 'Remote preview unavailable. Press again for local audio.';
        }));
        scope.$on('$destroy', stopPreview);
      }
    };
  });

  app.controller('ShellController', function ($scope, Auth, Cart) {
    this.user = Auth.user;
    this.cartCount = Cart.count;
    this.isAdmin = Auth.isAdmin;
    this.logout = Auth.logout;
    $scope.$watch(() => Auth.user, (user) => { this.user = user; });
    $scope.$on('cart:changed', () => {});
  });

  app.controller('AuthController', function (Api, Auth, $location) {
    this.mode = 'login';
    this.loginPayload = { username: 'customer', password: 'customer123' };
    this.registerPayload = {};
    this.login = () => Api.login(this.loginPayload).then((response) => {
      Auth.setSession(response);
      $location.path(Auth.isAdmin() ? '/dashboard' : '/home');
    }, (error) => { this.message = messageFrom(error, 'Login failed.'); });
    this.register = () => Api.register(this.registerPayload).then((response) => {
      Auth.setSession(response);
      $location.path('/home');
    }, (error) => { this.message = messageFrom(error, 'Registration failed.'); });
  });

  app.controller('HomeController', function (Api) {
    this.loading = true;
    Api.products().then((response) => {
      this.featured = response.data.slice(0, 3);
      this.loading = false;
    });
  });

  app.controller('ProductsController', function (Api, Cart) {
    this.loading = true;
    this.query = '';
    this.category = '';
    this.add = (product) => Cart.add(product, 1);
    Api.products().then((response) => {
      this.products = response.data;
      this.categories = [...new Set(response.data.map((product) => product.category))];
      this.loading = false;
    });
  });

  app.controller('ProductDetailsController', function ($routeParams, Api, Cart) {
    this.loading = true;
    this.quantity = 1;
    Api.product($routeParams.id).then((response) => {
      this.product = response.data;
      this.loading = false;
    });
    this.add = () => {
      Cart.add(this.product, this.quantity);
      this.added = true;
    };
  });

  app.controller('CartController', function (Cart) {
    this.items = Cart.items;
    this.total = Cart.total;
    this.update = Cart.update;
    this.remove = Cart.remove;
  });

  app.controller('CheckoutController', function (Api, Auth, Cart, $location) {
    if (!Auth.user) {
      $location.path('/login');
      return;
    }

    this.items = Cart.items;
    this.total = Cart.total;
    this.step = 'details';
    this.customer = Auth.user ? {
      name: `${Auth.user.firstName || ''} ${Auth.user.lastName || ''}`.trim(),
      email: Auth.user.email,
      phone: '',
      address: ''
    } : {};
    this.placeOrder = () => {
      const payload = {
        customer: this.customer,
        items: Cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        paymentMethodId: this.paymentMethodId || null
      };
      this.loading = true;
      Api.checkout(payload).then((response) => {
        Cart.clear();
        sessionStorage.setItem('lastOrder', JSON.stringify(response.data));
        $location.path(`/confirmation/${response.data.order.id}`);
      }, (error) => {
        this.loading = false;
        this.message = messageFrom(error, 'Checkout failed.');
      });
    };
  });

  app.controller('ConfirmationController', function ($routeParams) {
    const stored = JSON.parse(sessionStorage.getItem('lastOrder') || 'null');
    this.orderId = $routeParams.id;
    this.confirmation = stored && stored.order.id === this.orderId ? stored : null;
  });

  app.controller('ProfileController', function (Api, Auth, $location) {
    if (!Auth.user) {
      $location.path('/login');
      return;
    }

    this.user = Auth.user;
    this.loading = true;
    Api.myOrders().then((response) => {
      this.orders = response.data;
      this.loading = false;
    }, () => { this.loading = false; });
  });

  app.controller('DashboardController', function ($timeout, Api) {
    this.stats = {};
    this.loading = true;
    Api.dashboard().then((response) => {
      this.stats = response.data;
      this.loading = false;
      $timeout(() => renderDashboardCharts(this.stats), 80);
    });
  });

  app.controller('InventoryController', function (Api) {
    this.products = [];
    this.form = { category: 'Instrument', lowStockThreshold: 5, details: [] };
    this.query = '';
    this.load = () => Api.products().then((response) => { this.products = response.data; });
    this.save = () => Api.addProduct(this.form).then(() => {
      this.form = { category: 'Instrument', lowStockThreshold: 5, details: [] };
      this.load();
    }, (error) => { this.message = messageFrom(error, 'Product could not be saved.'); });
    this.quickRestock = (product) => {
      const updated = { ...product, quantity: Number(product.quantity || 0) + 5 };
      Api.updateProduct(updated).then(this.load);
    };
    this.load();
  });

  app.controller('SalesController', function ($timeout, Api) {
    this.products = [];
    this.sales = [];
    this.customers = [];
    this.form = { quantity: 1, customerName: 'Walk-in customer' };
    this.load = () => {
      Api.products().then((response) => { this.products = response.data; });
      Api.sales().then((response) => { this.sales = response.data; });
      Api.customers().then((response) => { this.customers = response.data; });
    };
    this.record = () => Api.recordSale(this.form).then(() => {
      this.form = { quantity: 1, customerName: 'Walk-in customer' };
      this.load();
    }, (error) => { this.message = messageFrom(error, 'Sale could not be recorded.'); });
    this.toggleInvoice = (id) => $timeout(() => $(`#invoice-${id}`).stop(true, true).slideToggle(180));
    this.load();
  });

  function messageFrom(error, fallback) {
    return error.data && error.data.message ? error.data.message : fallback;
  }

  function money(value) {
    return `PKR ${Number(value || 0).toLocaleString()}`;
  }

  function renderDashboardCharts(stats) {
    const salesCanvas = document.getElementById('salesChart');
    const stockCanvas = document.getElementById('stockChart');
    if (!salesCanvas || !stockCanvas || !window.Chart) {
      renderChartFallbacks(stats);
      return;
    }
    if (window.musicStoreCharts) {
      window.musicStoreCharts.forEach((chart) => chart.destroy());
    }
    window.musicStoreCharts = [];

    const recentSales = (stats.recentSales || []).length
      ? stats.recentSales
      : [{ label: 'No sales yet', total: 0 }];
    const categoryStock = Object.keys(stats.categoryStock || {}).length
      ? stats.categoryStock
      : { Inventory: 0 };

    const salesChart = new Chart(salesCanvas, {
      type: 'line',
      data: {
        labels: recentSales.map((item) => item.label),
        datasets: [{
          label: 'Sales Revenue',
          data: recentSales.map((item) => item.total),
          borderColor: '#c9a84c',
          backgroundColor: 'rgba(201, 168, 76, 0.18)',
          pointBackgroundColor: '#800000',
          pointBorderColor: '#c9a84c',
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        animation: { duration: 900, easing: 'easeOutQuart' },
        maintainAspectRatio: false,
        responsive: true,
        scales: {
          y: { beginAtZero: true, ticks: { callback: (value) => `PKR ${Number(value).toLocaleString()}` } }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (context) => money(context.parsed.y) } }
        }
      }
    });
    window.musicStoreCharts.push(salesChart);

    const stockChart = new Chart(stockCanvas, {
      type: 'doughnut',
      data: {
        labels: Object.keys(categoryStock),
        datasets: [{
          data: Object.values(categoryStock),
          backgroundColor: ['#800000', '#001F5B', '#c9a84c', '#5a0000', '#0a3580'],
          borderColor: '#fff8df',
          borderWidth: 3
        }]
      },
      options: {
        animation: { animateRotate: true, animateScale: true, duration: 900 },
        maintainAspectRatio: false,
        responsive: true,
        plugins: { legend: { position: 'bottom' } }
      }
    });
    window.musicStoreCharts.push(stockChart);
    renderChartFallbacks(stats);
  }

  function renderChartFallbacks(stats) {
    const salesFallback = document.getElementById('salesFallback');
    const stockFallback = document.getElementById('stockFallback');
    const recentSales = (stats.recentSales || []).length ? stats.recentSales : [{ label: 'No sales yet', total: 0 }];
    const maxSale = Math.max(...recentSales.map((item) => Number(item.total || 0)), 1);
    const categoryStock = Object.keys(stats.categoryStock || {}).length ? stats.categoryStock : { Inventory: 0 };
    const maxStock = Math.max(...Object.values(categoryStock).map((value) => Number(value || 0)), 1);

    if (salesFallback) {
      salesFallback.innerHTML = recentSales.map((item) => `
        <div class="fallback-bar-row">
          <span>${item.label}</span>
          <div><i style="width:${Math.max(6, (Number(item.total || 0) / maxSale) * 100)}%"></i></div>
          <strong>${money(item.total)}</strong>
        </div>
      `).join('');
    }

    if (stockFallback) {
      stockFallback.innerHTML = Object.entries(categoryStock).map(([label, value]) => `
        <div class="fallback-bar-row">
          <span>${label}</span>
          <div><i style="width:${Math.max(6, (Number(value || 0) / maxStock) * 100)}%"></i></div>
          <strong>${value}</strong>
        </div>
      `).join('');
    }
  }

  app.filter('money', function () {
    return money;
  });

  function loginTemplate() {
    return `
      <section class="auth-page">
        <div class="login-card reveal-card">
          <div class="login-header"><h1>Music Store</h1><p>Secure account access</p></div>
          <div class="login-body">
            <div class="btn-group w-100 mb-3">
              <button class="btn" ng-class="auth.mode === 'login' ? 'btn-maroon' : 'btn-outline-maroon'" ng-click="auth.mode='login'">Sign In</button>
              <button class="btn" ng-class="auth.mode === 'register' ? 'btn-navy' : 'btn-outline-maroon'" ng-click="auth.mode='register'">Create Account</button>
            </div>
            <div class="alert alert-danger" ng-if="auth.message">{{ auth.message }}</div>
            <form ng-if="auth.mode === 'login'" ng-submit="auth.login()">
              <label class="form-label">Username</label>
              <input class="form-control mb-3" ng-model="auth.loginPayload.username" required>
              <label class="form-label">Password</label>
              <input class="form-control mb-3" type="password" ng-model="auth.loginPayload.password" required>
              <button class="btn btn-maroon w-100">Enter Store</button>
            </form>
            <form ng-if="auth.mode === 'register'" ng-submit="auth.register()">
              <div class="row g-2">
                <div class="col"><input class="form-control mb-2" placeholder="First name" ng-model="auth.registerPayload.firstName" required></div>
                <div class="col"><input class="form-control mb-2" placeholder="Last name" ng-model="auth.registerPayload.lastName" required></div>
              </div>
              <input class="form-control mb-2" type="email" placeholder="Email" ng-model="auth.registerPayload.email" required>
              <input class="form-control mb-2" placeholder="Username" ng-model="auth.registerPayload.username" required>
              <input class="form-control mb-3" type="password" placeholder="Password" ng-model="auth.registerPayload.password" required>
              <button class="btn btn-navy w-100">Create Account</button>
            </form>
          </div>
        </div>
      </section>`;
  }

  function homeTemplate() {
    return `
      <section class="future-hero">
        <div class="container">
          <div class="hero-grid">
            <div class="reveal-card">
              <span class="eyebrow">Premium Music Retail</span>
              <h1>Instruments, vinyl, and studio essentials with a cinematic buying journey.</h1>
              <p>Explore curated gear, listen to album previews, build a persistent cart, and check out through an automated sales and inventory system.</p>
              <div class="d-flex gap-3 flex-wrap mt-4">
                <a href="#!/products" class="btn btn-maroon btn-lg">Browse Products</a>
                <a href="#!/profile" class="btn btn-outline-light btn-lg">My Account</a>
              </div>
            </div>
            <div class="hero-orb">
              <div class="orb-record"></div>
              <div class="orb-card">Live stock, instant sales records, audited inventory.</div>
            </div>
          </div>
        </div>
      </section>
      <section class="container my-5">
        <div class="section-heading"><span class="eyebrow">Featured</span><h2>Curated for performers and collectors</h2></div>
        <div class="loading-shimmer" ng-if="home.loading"></div>
        <div class="row g-4">
          <div class="col-md-4" ng-repeat="product in home.featured">
            <a class="product-tile" href="#!/products/{{ product.id }}">
              <img ng-src="{{ product.image }}" alt="{{ product.name }}">
              <div><span>{{ product.category }}</span><h4>{{ product.name }}</h4><p>{{ product.price | money }}</p></div>
            </a>
          </div>
        </div>
      </section>`;
  }

  function productsTemplate() {
    return `
      <section class="page-header"><div class="container"><h2><i class="bi bi-shop me-2"></i>Product Catalogue</h2></div></section>
      <section class="container mb-5">
        <div class="catalog-toolbar glass-panel">
          <input class="form-control" placeholder="Search instruments, albums, accessories..." ng-model="products.query">
          <select class="form-select" ng-model="products.category">
            <option value="">All categories</option>
            <option ng-repeat="category in products.categories" value="{{ category }}">{{ category }}</option>
          </select>
        </div>
        <div class="loading-shimmer" ng-if="products.loading"></div>
        <div class="row g-4">
          <div class="col-md-6 col-xl-3" ng-repeat="product in products.products | filter:products.query | filter:{ category: products.category }">
            <div class="card product-card h-100">
              <a href="#!/products/{{ product.id }}"><img ng-src="{{ product.image }}" alt="{{ product.name }}"></a>
              <div class="card-body">
                <div class="product-meta">{{ product.category }}</div>
                <h5>{{ product.name }}</h5>
                <p class="text-muted">{{ product.description }}</p>
                <p class="fw-bold">{{ product.price | money }}</p>
                <div class="d-flex gap-2">
                  <a class="btn btn-outline-maroon flex-fill" href="#!/products/{{ product.id }}">Details</a>
                  <button class="btn btn-maroon flex-fill" ng-disabled="product.quantity < 1" ng-click="products.add(product)">Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>`;
  }

  function productDetailsTemplate() {
    return `
      <section class="product-detail-hero" ng-if="!detail.loading">
        <div class="container">
          <div class="row g-5 align-items-center">
            <div class="col-lg-6">
              <img class="detail-image" ng-src="{{ detail.product.image }}" alt="{{ detail.product.name }}">
            </div>
            <div class="col-lg-6">
              <span class="eyebrow">{{ detail.product.category }}</span>
              <h1>{{ detail.product.name }}</h1>
              <p>{{ detail.product.description }}</p>
              <vinyl-player product="detail.product"></vinyl-player>
              <ul class="detail-list">
                <li ng-repeat="line in detail.product.details">{{ line }}</li>
              </ul>
              <div class="purchase-panel">
                <strong>{{ detail.product.price | money }}</strong>
                <input class="form-control" type="number" min="1" ng-model="detail.quantity">
                <button class="btn btn-maroon" ng-disabled="detail.product.quantity < detail.quantity" ng-click="detail.add()">Add to Cart</button>
              </div>
              <div class="alert alert-success mt-3" ng-if="detail.added">Added to cart. Your session is safely stored.</div>
            </div>
          </div>
        </div>
      </section>`;
  }

  function cartTemplate() {
    return `
      <section class="page-header"><div class="container"><h2><i class="bi bi-bag me-2"></i>Shopping Cart</h2></div></section>
      <section class="container mb-5">
        <div class="empty-state" ng-if="!cart.items.length"><h3>Your cart is ready for a first track.</h3><a href="#!/products" class="btn btn-maroon">Browse Products</a></div>
        <div class="row g-4" ng-if="cart.items.length">
          <div class="col-lg-8">
            <div class="cart-row" ng-repeat="item in cart.items">
              <img ng-src="{{ item.image }}" alt="{{ item.name }}">
              <div class="flex-grow-1"><h5>{{ item.name }}</h5><span>{{ item.price | money }}</span></div>
              <input class="form-control" type="number" min="1" ng-model="item.quantity" ng-change="cart.update(item.productId, item.quantity)">
              <button class="btn btn-sm btn-outline-maroon" ng-click="cart.remove(item.productId)">Remove</button>
            </div>
          </div>
          <div class="col-lg-4"><div class="summary-card"><h4>Order Summary</h4><div class="summary-line"><span>Total</span><strong>{{ cart.total() | money }}</strong></div><a href="#!/checkout" class="btn btn-maroon w-100">Checkout</a></div></div>
        </div>
      </section>`;
  }

  function checkoutTemplate() {
    return `
      <section class="page-header"><div class="container"><h2><i class="bi bi-credit-card me-2"></i>Checkout</h2></div></section>
      <section class="container mb-5">
        <div class="alert alert-danger" ng-if="checkout.message">{{ checkout.message }}</div>
        <div class="empty-state" ng-if="!checkout.items.length"><h3>Your cart is empty.</h3><a href="#!/products" class="btn btn-maroon">Return to Products</a></div>
        <form class="checkout-grid" ng-if="checkout.items.length" ng-submit="checkout.placeOrder()">
          <div class="glass-panel">
            <span class="eyebrow">Step 1</span><h4>Customer Details</h4>
            <input class="form-control mb-3" placeholder="Full name" ng-model="checkout.customer.name" required>
            <input class="form-control mb-3" type="email" placeholder="Email" ng-model="checkout.customer.email" required>
            <input class="form-control mb-3" placeholder="Phone" ng-model="checkout.customer.phone">
            <textarea class="form-control" placeholder="Delivery address" ng-model="checkout.customer.address" required></textarea>
          </div>
          <div class="glass-panel">
            <span class="eyebrow">Step 2</span><h4>Payment</h4>
            <p class="text-muted">Mock payment is enabled by default. Add a Stripe test payment method only when Stripe is configured.</p>
            <input class="form-control mb-3" placeholder="Optional Stripe test PaymentMethod ID" ng-model="checkout.paymentMethodId">
            <div class="summary-line"><span>Total</span><strong>{{ checkout.total() | money }}</strong></div>
            <button class="btn btn-navy w-100" ng-disabled="checkout.loading">{{ checkout.loading ? 'Confirming...' : 'Confirm Order' }}</button>
          </div>
        </form>
      </section>`;
  }

  function confirmationTemplate() {
    return `
      <section class="confirmation-screen">
        <div class="confirmation-card">
          <i class="bi bi-check2-circle"></i>
          <h1>Order Confirmed</h1>
          <p>Your order {{ confirm.orderId }} has been recorded, inventory has been updated, and the sale is visible in the admin dashboard.</p>
          <p class="text-muted" ng-if="confirm.confirmation">{{ confirm.confirmation.email.message }}</p>
          <div class="d-flex gap-3 justify-content-center flex-wrap">
            <a href="#!/profile" class="btn btn-maroon">View Account</a>
            <a href="#!/products" class="btn btn-outline-maroon">Continue Shopping</a>
          </div>
        </div>
      </section>`;
  }

  function profileTemplate() {
    return `
      <section class="page-header"><div class="container"><h2><i class="bi bi-person-circle me-2"></i>Customer Account</h2></div></section>
      <section class="container mb-5">
        <div class="profile-card glass-panel"><h3>{{ profile.user.firstName }} {{ profile.user.lastName }}</h3><p>{{ profile.user.email }}</p></div>
        <div class="card mt-4"><div class="card-header-navy"><h5>Order History</h5></div><div class="card-body">
          <p class="text-muted" ng-if="!profile.orders.length">No orders yet.</p>
          <div class="order-history-row" ng-repeat="order in profile.orders"><strong>{{ order.id }}</strong><span>{{ order.createdAt | date:'medium' }}</span><span>{{ order.total | money }}</span><span class="badge-navy">{{ order.status }}</span></div>
        </div></div>
      </section>`;
  }

  function dashboardTemplate() {
    return `
      <section class="page-header"><div class="container"><h2><i class="bi bi-speedometer2 me-2"></i>Operations Dashboard</h2></div></section>
      <section class="container mb-5">
        <div class="row g-4 mb-4">
          <div class="col-md-3"><div class="metric-card"><span>Sales</span><strong>{{ dash.stats.totalSales || 0 }}</strong></div></div>
          <div class="col-md-3"><div class="metric-card"><span>Orders</span><strong>{{ dash.stats.totalOrders || 0 }}</strong></div></div>
          <div class="col-md-3"><div class="metric-card"><span>Customers</span><strong>{{ dash.stats.totalCustomers || 0 }}</strong></div></div>
          <div class="col-md-3"><div class="metric-card"><span>Revenue</span><strong>{{ dash.stats.revenue | money }}</strong></div></div>
        </div>
        <div class="row g-4">
          <div class="col-lg-8"><div class="glass-panel chart-panel"><h4>Revenue Pulse</h4><div class="chart-frame"><canvas id="salesChart"></canvas></div><div id="salesFallback" class="chart-fallback"></div></div></div>
          <div class="col-lg-4"><div class="glass-panel chart-panel"><h4>Stock Mix</h4><div class="chart-frame chart-frame-small"><canvas id="stockChart"></canvas></div><div id="stockFallback" class="chart-fallback"></div></div></div>
          <div class="col-lg-6"><div class="card"><div class="card-header-maroon"><h5>Low-Stock Alerts</h5></div><div class="card-body"><div ng-repeat="item in dash.stats.lowStock" class="alert-row"><span>{{ item.name }}</span><span class="low-stock-badge">{{ item.quantity }} left</span></div><p ng-if="!dash.stats.lowStock.length" class="text-muted mb-0">All stock levels are healthy.</p></div></div></div>
          <div class="col-lg-6"><div class="card"><div class="card-header-navy"><h5>Activity Stream</h5></div><div class="card-body"><div ng-repeat="item in dash.stats.recentActivity" class="activity-row"><strong>{{ item.action }}</strong><span>{{ item.details }}</span></div></div></div></div>
        </div>
      </section>`;
  }

  function inventoryTemplate() {
    return `
      <section class="page-header"><div class="container"><h2><i class="bi bi-box-seam me-2"></i>Inventory Command Center</h2></div></section>
      <section class="container mb-5"><div class="row g-4">
        <div class="col-lg-4"><div class="card"><div class="card-header-maroon"><h5>Add Product</h5></div><div class="card-body">
          <div class="alert alert-danger" ng-if="inventory.message">{{ inventory.message }}</div>
          <form ng-submit="inventory.save()">
            <input class="form-control mb-2" placeholder="Product name" ng-model="inventory.form.name" required>
            <input class="form-control mb-2" placeholder="Category" ng-model="inventory.form.category">
            <textarea class="form-control mb-2" placeholder="Professional product description" ng-model="inventory.form.description"></textarea>
            <input class="form-control mb-2" type="number" placeholder="Quantity" ng-model="inventory.form.quantity" required>
            <input class="form-control mb-2" type="number" placeholder="Low-stock threshold" ng-model="inventory.form.lowStockThreshold">
            <input class="form-control mb-2" type="number" placeholder="Price PKR" ng-model="inventory.form.price" required>
            <input class="form-control mb-3" placeholder="Image URL" ng-model="inventory.form.image">
            <button class="btn btn-maroon w-100">Save Product</button>
          </form>
        </div></div></div>
        <div class="col-lg-8"><div class="card"><div class="card-header-navy"><h5>Interactive Inventory</h5></div><div class="card-body">
          <input class="form-control mb-3" placeholder="Filter inventory instantly" ng-model="inventory.query">
          <div class="table-responsive"><table class="table table-custom"><thead><tr><th>Name</th><th>Category</th><th>Qty</th><th>Price</th><th>Status</th><th></th></tr></thead>
            <tbody><tr ng-repeat="product in inventory.products | filter:inventory.query">
              <td>{{ product.name }}</td><td>{{ product.category }}</td><td>{{ product.quantity }}</td><td>{{ product.price | money }}</td>
              <td><span ng-if="product.quantity <= product.lowStockThreshold" class="low-stock-badge">Low Stock</span><span ng-if="product.quantity > product.lowStockThreshold" class="badge-navy">Healthy</span></td>
              <td><button class="btn btn-sm btn-outline-maroon" ng-click="inventory.quickRestock(product)">+5 Restock</button></td>
            </tr></tbody>
          </table></div>
        </div></div></div>
      </div></section>`;
  }

  function salesTemplate() {
    return `
      <section class="page-header"><div class="container"><h2><i class="bi bi-receipt me-2"></i>Sales & Customers</h2></div></section>
      <section class="container mb-5"><div class="row g-4">
        <div class="col-lg-4"><div class="card"><div class="card-header-maroon"><h5>Record Staff Sale</h5></div><div class="card-body">
          <div class="alert alert-danger" ng-if="sales.message">{{ sales.message }}</div>
          <form ng-submit="sales.record()">
            <select class="form-select mb-2" ng-model="sales.form.productId" required ng-options="p.id as p.name for p in sales.products"></select>
            <input class="form-control mb-2" type="number" min="1" ng-model="sales.form.quantity" required>
            <input class="form-control mb-2" ng-model="sales.form.customerName" placeholder="Customer name">
            <input class="form-control mb-2" ng-model="sales.form.customerEmail" placeholder="Customer email">
            <input class="form-control mb-3" ng-model="sales.form.customerPhone" placeholder="Customer phone">
            <button class="btn btn-maroon w-100">Submit Sale</button>
          </form>
        </div></div></div>
        <div class="col-lg-8"><div class="card"><div class="card-header-navy"><h5>Transaction Ledger</h5></div><div class="card-body p-0">
          <div class="table-responsive"><table class="table table-custom mb-0"><thead><tr><th>Invoice</th><th>Customer</th><th>Source</th><th>Total</th><th></th></tr></thead><tbody>
            <tr ng-repeat-start="sale in sales.sales"><td>{{ sale.id }}</td><td>{{ sale.customerName }}</td><td>{{ sale.source }}</td><td>{{ sale.total | money }}</td><td><button class="btn btn-sm btn-outline-maroon" ng-click="sales.toggleInvoice(sale.id)">Details</button></td></tr>
            <tr ng-repeat-end><td colspan="5" class="invoice-details" id="invoice-{{ sale.id }}"><div ng-repeat="item in sale.items">{{ item.quantity }} x {{ item.name }} at {{ item.price | money }}</div><strong>{{ sale.customer.email }}</strong></td></tr>
          </tbody></table></div>
        </div></div></div>
      </div></section>`;
  }
})();
