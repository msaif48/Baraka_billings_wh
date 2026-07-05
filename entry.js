// 1. Clearly list all external dependencies
require('dotenv').config();
require('express');
require('cors');
require('jsonwebtoken');
require('bcryptjs');
require('node-cron');
require('open');
require('whatsapp-web.js');
require('express-rate-limit');
require('nedb-promises');

// 2. Tell PKG to explicitly pack the protected license module
require('./license-protected.js');

// 3. Launch the protected application
require('./server-protected.js');


require('./whatsapp-protected.js');