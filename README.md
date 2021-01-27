## KIBANA-AWS-PROXY

### Usage
This module fetches a list of elasticsearch domains from your aws region, lets you select one, and then runs a proxy to sign requests using your local (preconfigured) AWS credentials and configuration.

In order to reach elasticsearch instances inside your vpc, a way to reach your private IPs must be available, such as AWS Direct Connect

To start the proxy, use:
`npx kibana-aws-proxy`