require('dotenv').config();
const express = require('express');
const { setupRoutes } = require('./src/api/routes');
const { errorHandler, requestLogger } = require('./src/api/middleware');
const logger = require('./src/utils/logger');
const { initRuleLoader } = require('./src/services/ruleService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(requestLogger);
app.use(express.static('public'));

// Routes
setupRoutes(app);

// Error handler (must be last)
app.use(errorHandler);

// Start rule hot-reload
initRuleLoader();

app.listen(PORT, () => {
  logger.info(`🚀 Notification Prioritization Engine running on port ${PORT}`);
  logger.info(`📖 Interactive demo → http://localhost:${PORT}`);
  logger.info(`🔗 API base         → http://localhost:${PORT}/v1`);
});

module.exports = app;
