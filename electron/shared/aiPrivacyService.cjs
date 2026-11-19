"use strict";
const {createAiPrivacyService} = require("../../domain/aiPrivacyService.shared.cjs").createPrivacyServiceFactory(require("../mcp/externalMcpRedaction.cjs"));
const aiPrivacyService = createAiPrivacyService({initialized:false});
module.exports = {...aiPrivacyService, aiPrivacyService, createAiPrivacyService};
