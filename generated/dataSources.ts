/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * This file is auto-generated. Do not modify it manually.
 * Changes to this file may be overwritten.
 */

export default {
  "agentnode": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "InvokeDefinition": {
        "path": "/{connectionId}/copilotflows/agentnodes/invokeDefinition",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-conversation-id",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "x-ms-workflow-name",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "x-ms-workflow-operation-name",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      }
    }
  }
};
