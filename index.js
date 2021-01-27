#!/usr/bin/env node
'use strict';
process.env.AWS_SDK_LOAD_CONFIG = true;

const AWS = require('aws-sdk');
const express = require('express');
const {spawn} = require('child_process');

const SignerV4 = AWS.Signers.V4;
const AWSHttpClient = AWS.HttpClient;


let credentials;
let endpoint;
let host;
let region;
let service;

let openCmd;

switch(process.platform) {
    case 'darwin':
        openCmd = 'open';
        break;
    case 'win32':
        openCmd = 'explorer.exe';
        break;
    case 'linux':
        openCmd = 'xdg-open';
        break;
    default:
        throw new Error('Unsupported platform: ' + process.platform);
}



function loadCredentials() {
  return new Promise((resolve, reject) => {
    AWS.config.getCredentials((err, _credentials) => {
      if(err) return reject(err);
      credentials = _credentials;
      resolve(credentials);
    });
  })
}


function open(url, callback) {
  var child = spawn(openCmd, [url]);
  var errorText = "";
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', function (data) {
      errorText += data;
  });
  child.stderr.on('end', function () {
      if (errorText.length > 0) {
          var error = new Error(errorText);
          if (callback) {
              callback(error);
          } else {
              throw error;
          }
      } else if (callback) {
          callback(error);
      }
  });
}

function getQuery(url) {
  const i = url.indexOf('?');
  if(i > 0)
    return url.substr(i);
  return null;
}


const app = express();
app.use((req, res, next) => {
  req.body = '';
  req.on('data', data => req.body += data.toString('utf-8'));
  req.on('end', () => next());
  res.statusCode = 200;
});

function wrapHandler(handler) {
  return (req, res) => Promise.resolve(handler(req, res))
    .catch(err => res.status(500).send(err.message));
}

app.get('/_login', wrapHandler(async (req, res) => {
  const es = new AWS.ES();
  if(req.query.target) {
    const target = req.query.target;
    const domain = await es.describeElasticsearchDomain({
      DomainName:target
    }).promise();
    host = domain.DomainStatus.Endpoints.vpc;
    endpoint = new AWS.Endpoint('https://'+host);

    const match = host.match(/^[a-z0-9\-]+\.([a-z0-9\-]+)\.([a-z0-9\-]+)\.amazonaws.com$/);
    if(!match) return res.status(500).send('Error parsing host');

    region = match[1];
    service = match[2];

    if(!region) res.status(500).send('invalid host');

    res.redirect('/_plugin/kibana/');
  } else {
    await loadCredentials();
    const domains = await es.listDomainNames().promise();

    const buttons = domains.DomainNames.map(d => {
      return '<input type="submit" name="target" value="'+d.DomainName+'" /><br/><br/>';
    }).join('');

    res.send('<h1>Pick Elasticsearch instance</h1><form>'+buttons+'</form>');
  }
}));

app.use('/*', (req, res) => {
  if(!host || !credentials || credentials.expired) return res.redirect('/_login');


  const query = getQuery(req.originalUrl);

  const request = new AWS.HttpRequest(endpoint, region);
  request.method = req.method;
  request.path += req.params[0];
  if(query)
    request.path += query;

  for(const header of Object.keys(req.headers)) {
    if(header.startsWith('kbn') || header.startsWith('x')) {
      request.headers[header] = req.headers[header];
    }
  }
  if(typeof req.body === 'string' && req.headers['content-type']) {
    request.body = req.body;
    request.headers['content-type'] = req.headers['content-type'];
    request.headers['content-length'] = ''+Buffer.byteLength(req.body);
  }
  request.headers['host'] = host;
  if(req.headers.accept)
    request.headers['accept'] = req.headers.accept;
  if(req.headers.referer)
    request.headers['referer'] = req.headers.referer;

  const signer = new SignerV4(request, service);
  signer.addAuthorization(credentials, new Date());

  var client = new AWSHttpClient();
  client.handleRequest(request, null, (response) => {
    res.status(response.statusCode);
    for(const header in response.headers) {
      let value = response.headers[header];
      res.setHeader(header, value);
    }

    response.pipe(res);
  }, (error) => {
    console.log('Error: ' + error);
  });
});

loadCredentials().then(() => {
  app.listen(9200, 'localhost', () => {
    open('http://localhost:9200/_login');
  });
});

