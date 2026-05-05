# Deploying warehouse-mcp on Kubernetes

A first-class Helm chart is post-1.0 work. Until then, the manifests below are a known-good starting point. Copy, adjust, apply.

## Minimal example: Deployment + Service + Secret

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: warehouse-mcp
---
apiVersion: v1
kind: Secret
metadata:
  name: warehouse-mcp-config
  namespace: warehouse-mcp
type: Opaque
stringData:
  # Replace these — these are placeholders.
  PG_HOST: "db.private.local"
  PG_DATABASE: "analytics"
  PG_USER: "mcp_reader"
  PG_PASSWORD: "********"
  MCP_API_KEYS: "rotateme-32hex-bearer-key:reader"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: warehouse-mcp
  namespace: warehouse-mcp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: warehouse-mcp
  template:
    metadata:
      labels:
        app: warehouse-mcp
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: server
        image: ghcr.io/kalehdoo/warehouse-mcp:0.1.0
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 3001
          name: mcp
        env:
        - name: WAREHOUSE_TYPE
          value: postgres
        - name: PG_PORT
          value: "5432"
        - name: PG_SSL
          value: "true"
        - name: MCP_TRANSPORT
          value: http
        - name: MCP_SERVER_HOST
          value: "0.0.0.0"
        envFrom:
        - secretRef:
            name: warehouse-mcp-config
        resources:
          requests: { cpu: "100m", memory: "256Mi" }
          limits:   { cpu: "500m", memory: "512Mi" }
        readinessProbe:
          httpGet: { path: /health, port: mcp }
          initialDelaySeconds: 5
        livenessProbe:
          httpGet: { path: /health, port: mcp }
          initialDelaySeconds: 30
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: [ALL]
        volumeMounts:
        - { name: audit, mountPath: /app/audit }
        - { name: tmp,   mountPath: /tmp }
      volumes:
      - { name: audit, emptyDir: {} }
      - { name: tmp,   emptyDir: {} }
---
apiVersion: v1
kind: Service
metadata:
  name: warehouse-mcp
  namespace: warehouse-mcp
spec:
  selector:
    app: warehouse-mcp
  ports:
  - port: 3001
    targetPort: mcp
```

## Things this manifest deliberately does *not* do

- **Ingress.** Use whatever ingress controller / service mesh you already run. Terminate TLS there.
- **Persistent audit log.** `emptyDir` works for short-lived nodes but loses the log when the pod is rescheduled. For real auditability, mount a PVC or stream to a sidecar that ships logs to your SIEM.
- **HPA.** The MCP server is mostly I/O-bound — CPU autoscaling rarely helps. Set `replicas` to whatever covers your peak concurrency.
- **NetworkPolicy.** Strongly recommended in production. Restrict egress to your warehouse's IP/DNS and ingress to your AI client's namespace.

## Multi-tenant deployments

v1 is single-tenant: one Pod = one warehouse. To serve multiple tenants today, run multiple Deployments, one per tenant config.

A multi-tenant SaaS variant is on the roadmap and will share a single Deployment behind tenant-aware auth.
