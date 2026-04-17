package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"gopkg.in/yaml.v3"
)

var version = "dev"

// setupLogging configures the logger to write to a file on Windows.
// On Linux the default stderr output is captured by systemd/journald.
// Returns a cleanup function that should be deferred by the caller.
func setupLogging() func() {
	log.SetFlags(log.Ldate | log.Ltime)

	if runtime.GOOS != "windows" {
		return func() {}
	}

	programData := os.Getenv("ProgramData")
	if programData == "" {
		programData = `C:\ProgramData`
	}
	logDir := filepath.Join(programData, "CertDax", "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		// Can't create log dir — fall back to stderr only
		return func() {}
	}

	logPath := filepath.Join(logDir, "certdax-agent.log")

	// Simple size-based rotation: keep one archive at .1
	if fi, err := os.Stat(logPath); err == nil && fi.Size() > 10*1024*1024 {
		_ = os.Remove(logPath + ".1")
		_ = os.Rename(logPath, logPath+".1")
	}

	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		// Can't open log file — fall back to stderr only
		return func() {}
	}

	// Write to both the log file and stderr (stderr is visible in sc.exe debug runs)
	log.SetOutput(io.MultiWriter(os.Stderr, f))
	log.Printf("[INFO] Logging to %s", logPath)

	return func() { f.Close() }
}

// Config holds the agent configuration.
type Config struct {
	APIURL       string `yaml:"api_url"`
	AgentToken   string `yaml:"agent_token"`
	PollInterval int    `yaml:"poll_interval"`
}

// Deployment represents a pending deployment from the API.
type Deployment struct {
	ID              int    `json:"id"`
	CertificateID   int    `json:"certificate_id"`
	TargetID        int    `json:"target_id"`
	TargetName      string `json:"target_name"`
	CertificateName string `json:"certificate_name"`
	Status          string `json:"status"`
}

// CertificateData is the response from the certificate download endpoint.
type CertificateData struct {
	CommonName      string `json:"common_name"`
	CertificatePEM  string `json:"certificate_pem"`
	PrivateKeyPEM   string `json:"private_key_pem"`
	ChainPEM        string `json:"chain_pem"`
	FullchainPEM    string `json:"fullchain_pem"`
	DeployPath      string `json:"deploy_path"`
	ReloadCommand   string `json:"reload_command"`
	PreDeployScript  string `json:"pre_deploy_script"`
	PostDeployScript string `json:"post_deploy_script"`
	DeployFormat    string `json:"deploy_format"`
	PFXData         string `json:"pfx_data"`
	IsCA            bool   `json:"is_ca"`
}

// Agent is the main deploy agent.
type Agent struct {
	config Config
	client *http.Client
}

// NewAgent creates a new Agent instance.
func NewAgent(cfg Config) *Agent {
	return &Agent{
		config: cfg,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (a *Agent) apiRequest(method, path string, body interface{}) (*http.Response, error) {
	url := strings.TrimRight(a.config.APIURL, "/") + path

	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+a.config.AgentToken)
	req.Header.Set("Content-Type", "application/json")

	return a.client.Do(req)
}

func (a *Agent) heartbeat() {
	hostname, _ := os.Hostname()
	payload := map[string]string{
		"hostname": hostname,
		"os":       getOSPrettyName(),
		"arch":     runtime.GOARCH,
		"version":  version,
	}

	resp, err := a.apiRequest("POST", "/api/agent/heartbeat", payload)
	if err != nil {
		log.Printf("[WARN] Heartbeat failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[WARN] Heartbeat returned status %d", resp.StatusCode)
	}
}

func (a *Agent) poll() []Deployment {
	resp, err := a.apiRequest("GET", "/api/agent/poll", nil)
	if err != nil {
		log.Printf("[WARN] Poll failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[WARN] Poll returned status %d", resp.StatusCode)
		return nil
	}

	var deployments []Deployment
	if err := json.NewDecoder(resp.Body).Decode(&deployments); err != nil {
		log.Printf("[WARN] Poll decode failed: %v", err)
		return nil
	}

	return deployments
}

func (a *Agent) getCertificate(deploymentID int) (*CertificateData, error) {
	path := fmt.Sprintf("/api/agent/certificate/%d", deploymentID)
	resp, err := a.apiRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get certificate returned %d: %s", resp.StatusCode, body)
	}

	var data CertificateData
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("decode certificate: %w", err)
	}

	return &data, nil
}

func (a *Agent) reportStatus(deploymentID int, status string, errMsg string) {
	path := fmt.Sprintf("/api/agent/deploy/%d/status", deploymentID)
	payload := map[string]interface{}{
		"status":        status,
		"error_message": nil,
	}
	if errMsg != "" {
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		payload["error_message"] = errMsg
	}

	resp, err := a.apiRequest("POST", path, payload)
	if err != nil {
		log.Printf("[WARN] Status report failed for deployment %d: %v", deploymentID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[WARN] Status report for deployment %d returned %d: %s", deploymentID, resp.StatusCode, body)
	}
}

func safeName(commonName string) string {
	name := strings.ReplaceAll(commonName, "*", "wildcard")
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, " ", "_")
	return name
}

func getOSPrettyName() string {
	if runtime.GOOS == "windows" {
		// Read Windows version from registry or use environment
		return "Windows"
	}
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return runtime.GOOS
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			val := strings.TrimPrefix(line, "PRETTY_NAME=")
			val = strings.Trim(val, "\"")
			if val != "" {
				return val
			}
		}
	}
	return runtime.GOOS
}

func writeFile(path, content string, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}
	return os.WriteFile(path, []byte(content), perm)
}

// runScript writes a script to a temp file and executes it.
// On Linux/macOS, it runs with sh. On Windows, it runs with powershell.exe.
func runScript(label string, id int, script string) error {
	ext := ".sh"
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		ext = ".ps1"
	}

	tmpFile, err := os.CreateTemp("", "certdax-*"+ext)
	if err != nil {
		return fmt.Errorf("create temp script: %w", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(script); err != nil {
		tmpFile.Close()
		return fmt.Errorf("write temp script: %w", err)
	}
	tmpFile.Close()

	if runtime.GOOS != "windows" {
		if err := os.Chmod(tmpFile.Name(), 0700); err != nil {
			return fmt.Errorf("chmod temp script: %w", err)
		}
		cmd = exec.Command("sh", tmpFile.Name())
	} else {
		cmd = exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", tmpFile.Name())
	}

	log.Printf("[INFO] %s %d: running %s script", label, id, strings.ToLower(label[:1])+label[1:])

	var cmdOutput bytes.Buffer
	cmd.Stdout = &cmdOutput
	cmd.Stderr = &cmdOutput

	if err := cmd.Run(); err != nil {
		output := strings.TrimSpace(cmdOutput.String())
		errMsg := fmt.Sprintf("script failed: %v", err)
		if output != "" {
			errMsg = fmt.Sprintf("script failed: %v — output: %s", err, output)
		}
		return fmt.Errorf("%s", errMsg)
	}

	return nil
}

func (a *Agent) deployCertificate(deploymentID int) {
	certData, err := a.getCertificate(deploymentID)
	if err != nil {
		log.Printf("[ERROR] Deployment %d: fetch certificate failed: %v", deploymentID, err)
		a.reportStatus(deploymentID, "failed", err.Error())
		return
	}

	deployPath := certData.DeployPath
	name := safeName(certData.CommonName)
	format := certData.DeployFormat
	if format == "" {
		format = "crt"
	}

	// Create deploy directory
	if err := os.MkdirAll(deployPath, 0755); err != nil {
		errMsg := fmt.Sprintf("create deploy dir: %v", err)
		log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
		a.reportStatus(deploymentID, "failed", errMsg)
		return
	}

	// Execute pre-deploy script
	if certData.PreDeployScript != "" {
		log.Printf("[INFO] Deployment %d: running pre-deploy script", deploymentID)
		if err := runScript("Deployment", deploymentID, certData.PreDeployScript); err != nil {
			errMsg := fmt.Sprintf("pre-deploy script failed: %v", err)
			log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}
		log.Printf("[INFO] Deployment %d: pre-deploy script completed", deploymentID)
	}

	// Write certificate files based on format
	switch format {
	case "crt":
		files := map[string]struct {
			content string
			perm    os.FileMode
		}{
			name + ".crt":           {certData.CertificatePEM, 0644},
			name + ".key":           {certData.PrivateKeyPEM, 0600},
			name + ".fullchain.crt": {certData.FullchainPEM, 0644},
		}
		if certData.ChainPEM != "" {
			files[name+".chain.crt"] = struct {
				content string
				perm    os.FileMode
			}{certData.ChainPEM, 0644}
		}
		for filename, f := range files {
			path := filepath.Join(deployPath, filename)
			if err := writeFile(path, f.content, f.perm); err != nil {
				errMsg := fmt.Sprintf("write %s: %v", filename, err)
				log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
				a.reportStatus(deploymentID, "failed", errMsg)
				return
			}
		}

	case "pem":
		// Combined PEM: key + cert + chain in one file
		parts := []string{certData.PrivateKeyPEM, certData.CertificatePEM}
		if certData.ChainPEM != "" {
			parts = append(parts, certData.ChainPEM)
		}
		combined := strings.Join(parts, "\n")
		path := filepath.Join(deployPath, name+".pem")
		if err := writeFile(path, combined, 0600); err != nil {
			errMsg := fmt.Sprintf("write %s.pem: %v", name, err)
			log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}

	case "pfx":
		if certData.PFXData == "" {
			errMsg := "server did not provide PFX data"
			log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}
		pfxBytes, err := base64.StdEncoding.DecodeString(certData.PFXData)
		if err != nil {
			errMsg := fmt.Sprintf("decode pfx data: %v", err)
			log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}
		path := filepath.Join(deployPath, name+".pfx")
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			errMsg := fmt.Sprintf("create dir: %v", err)
			log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}
		if err := os.WriteFile(path, pfxBytes, 0600); err != nil {
			errMsg := fmt.Sprintf("write %s.pfx: %v", name, err)
			log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}

	default:
		errMsg := fmt.Sprintf("unknown deploy format: %s", format)
		log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
		a.reportStatus(deploymentID, "failed", errMsg)
		return
	}

	log.Printf("[INFO] Deployment %d: certificate files written to %s (format: %s)", deploymentID, deployPath, format)

	// On Windows, also deploy certificate into the appropriate Windows cert store
	if runtime.GOOS == "windows" {
		if err := deployToWindowsStore(certData.CertificatePEM, certData.IsCA); err != nil {
			log.Printf("[WARN] Deployment %d: Windows cert store install failed: %v", deploymentID, err)
		} else {
			storeName := "Personal (My)"
			if certData.IsCA {
				storeName = "Trusted Root Certification Authorities"
			}
			log.Printf("[INFO] Deployment %d: certificate installed in Windows cert store: %s", deploymentID, storeName)
		}
	}

	// Execute post-deploy script
	if certData.PostDeployScript != "" {
		log.Printf("[INFO] Deployment %d: running post-deploy script", deploymentID)
		if err := runScript("Deployment", deploymentID, certData.PostDeployScript); err != nil {
			errMsg := fmt.Sprintf("post-deploy script failed: %v", err)
			log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}
		log.Printf("[INFO] Deployment %d: post-deploy script completed", deploymentID)
	}

	// Execute reload command
	if certData.ReloadCommand != "" {
		log.Printf("[INFO] Deployment %d: running reload command: %s", deploymentID, certData.ReloadCommand)

		var cmdOutput bytes.Buffer
		var cmd *exec.Cmd
		if runtime.GOOS == "windows" {
			cmd = exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command", certData.ReloadCommand)
		} else {
			cmd = exec.Command("sh", "-c", certData.ReloadCommand)
		}
		cmd.Stdout = &cmdOutput
		cmd.Stderr = &cmdOutput

		if err := cmd.Run(); err != nil {
			output := strings.TrimSpace(cmdOutput.String())
			errMsg := fmt.Sprintf("reload command failed: %v", err)
			if output != "" {
				errMsg = fmt.Sprintf("reload command failed: %v — output: %s", err, output)
			}
			log.Printf("[ERROR] Deployment %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}

		log.Printf("[INFO] Deployment %d: reload command completed", deploymentID)
	}

	a.reportStatus(deploymentID, "deployed", "")
	log.Printf("[INFO] Deployment %d: completed for %s", deploymentID, certData.CommonName)
}

// RemovalData is the response from the removal info endpoint.
type RemovalData struct {
	CommonName       string `json:"common_name"`
	DeployPath       string `json:"deploy_path"`
	ReloadCommand    string `json:"reload_command"`
	PreDeployScript  string `json:"pre_deploy_script"`
	PostDeployScript string `json:"post_deploy_script"`
	DeployFormat     string `json:"deploy_format"`
}

func (a *Agent) getRemovalInfo(deploymentID int) (*RemovalData, error) {
	path := fmt.Sprintf("/api/agent/removal/%d", deploymentID)
	resp, err := a.apiRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get removal info returned %d: %s", resp.StatusCode, body)
	}

	var data RemovalData
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("decode removal info: %w", err)
	}

	return &data, nil
}

func (a *Agent) undeployCertificate(deploymentID int) {
	info, err := a.getRemovalInfo(deploymentID)
	if err != nil {
		log.Printf("[ERROR] Removal %d: fetch info failed: %v", deploymentID, err)
		a.reportStatus(deploymentID, "failed", err.Error())
		return
	}

	name := safeName(info.CommonName)
	deployPath := info.DeployPath
	format := info.DeployFormat
	if format == "" {
		format = "crt"
	}

	// Execute pre-deploy script (before removal)
	if info.PreDeployScript != "" {
		log.Printf("[INFO] Removal %d: running pre-deploy script", deploymentID)
		if err := runScript("Removal", deploymentID, info.PreDeployScript); err != nil {
			log.Printf("[WARN] Removal %d: pre-deploy script failed: %v (continuing with removal)", deploymentID, err)
		} else {
			log.Printf("[INFO] Removal %d: pre-deploy script completed", deploymentID)
		}
	}

	// Remove certificate files based on format
	var filenames []string
	switch format {
	case "crt":
		filenames = []string{
			name + ".crt",
			name + ".key",
			name + ".fullchain.crt",
			name + ".chain.crt",
		}
	case "pem":
		filenames = []string{name + ".pem"}
	case "pfx":
		filenames = []string{name + ".pfx"}
	default:
		filenames = []string{
			name + ".crt",
			name + ".key",
			name + ".fullchain.crt",
			name + ".chain.crt",
		}
	}

	var removed int
	for _, filename := range filenames {
		path := filepath.Join(deployPath, filename)
		if err := os.Remove(path); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			errMsg := fmt.Sprintf("remove %s: %v", filename, err)
			log.Printf("[ERROR] Removal %d: %s", deploymentID, errMsg)
			a.reportStatus(deploymentID, "failed", errMsg)
			return
		}
		removed++
	}

	log.Printf("[INFO] Removal %d: removed %d certificate files from %s", deploymentID, removed, deployPath)

	// Execute post-deploy script (after removal)
	if info.PostDeployScript != "" {
		log.Printf("[INFO] Removal %d: running post-deploy script", deploymentID)
		if err := runScript("Removal", deploymentID, info.PostDeployScript); err != nil {
			log.Printf("[WARN] Removal %d: post-deploy script failed: %v (files already removed)", deploymentID, err)
		} else {
			log.Printf("[INFO] Removal %d: post-deploy script completed", deploymentID)
		}
	}

	// Execute reload command
	if info.ReloadCommand != "" {
		log.Printf("[INFO] Removal %d: running reload command: %s", deploymentID, info.ReloadCommand)

		var cmdOutput bytes.Buffer
		var cmd *exec.Cmd
		if runtime.GOOS == "windows" {
			cmd = exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-Command", info.ReloadCommand)
		} else {
			cmd = exec.Command("sh", "-c", info.ReloadCommand)
		}
		cmd.Stdout = &cmdOutput
		cmd.Stderr = &cmdOutput

		if err := cmd.Run(); err != nil {
			output := strings.TrimSpace(cmdOutput.String())
			errMsg := fmt.Sprintf("reload command failed: %v", err)
			if output != "" {
				errMsg = fmt.Sprintf("reload command failed: %v — output: %s", err, output)
			}
			log.Printf("[WARN] Removal %d: %s (files already removed)", deploymentID, errMsg)
		}
	}

	a.reportStatus(deploymentID, "removed", "")
	log.Printf("[INFO] Removal %d: completed for %s", deploymentID, info.CommonName)
}

// Run starts the agent with OS signal handling (interactive / console mode).
func (a *Agent) Run() {
	sigStop := make(chan os.Signal, 1)
	signal.Notify(sigStop, syscall.SIGINT, syscall.SIGTERM)
	stop := make(chan struct{})
	go func() {
		sig := <-sigStop
		log.Printf("[INFO] Received signal %v, shutting down", sig)
		close(stop)
	}()
	a.runLoop(stop)
}

// runLoop is the core polling loop. It exits when stop is closed.
// This is used both by Run() (signal-driven) and by the Windows SCM handler.
func (a *Agent) runLoop(stop <-chan struct{}) {
	log.Printf("[INFO] CertDax Agent %s starting", version)
	log.Printf("[INFO] API: %s", a.config.APIURL)
	log.Printf("[INFO] Poll interval: %ds", a.config.PollInterval)
	log.Printf("[INFO] OS: %s/%s", runtime.GOOS, runtime.GOARCH)

	ticker := time.NewTicker(time.Duration(a.config.PollInterval) * time.Second)
	defer ticker.Stop()

	// Initial run
	a.heartbeat()
	a.processDeployments()

	for {
		select {
		case <-ticker.C:
			a.heartbeat()
			a.processDeployments()
		case <-stop:
			log.Printf("[INFO] Shutting down")
			return
		}
	}
}

func (a *Agent) processDeployments() {
	deployments := a.poll()
	for _, dep := range deployments {
		name := dep.CertificateName
		if name == "" {
			name = "unknown"
		}
		if dep.Status == "pending_removal" {
			log.Printf("[INFO] Processing removal %d for %s", dep.ID, name)
			a.undeployCertificate(dep.ID)
		} else {
			log.Printf("[INFO] Processing deployment %d for %s", dep.ID, name)
			a.deployCertificate(dep.ID)
		}
	}
}

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return &cfg, nil
}

func main() {
	var (
		configPath   string
		apiURL       string
		token        string
		pollInterval int
		showVersion  bool
	)

	flag.StringVar(&configPath, "config", "", "Path to config YAML file")
	flag.StringVar(&apiURL, "api-url", "", "CertDax API URL")
	flag.StringVar(&token, "token", "", "Agent authentication token")
	flag.IntVar(&pollInterval, "poll-interval", 30, "Poll interval in seconds")
	flag.BoolVar(&showVersion, "version", false, "Show version and exit")
	flag.Parse()

	closeLog := setupLogging()
	defer closeLog()

	if showVersion {
		fmt.Printf("certdax-agent %s (%s/%s)\n", version, runtime.GOOS, runtime.GOARCH)
		os.Exit(0)
	}

	// If no config path given, use OS-appropriate default
	if configPath == "" {
		if runtime.GOOS == "windows" {
			programData := os.Getenv("ProgramData")
			if programData == "" {
				programData = `C:\ProgramData`
			}
			configPath = filepath.Join(programData, "CertDax", "config.yaml")
		} else {
			configPath = "/etc/certdax/config.yaml"
		}
	}

	// Priority: flags > env vars > config file
	if apiURL == "" {
		apiURL = os.Getenv("CERTDAX_API_URL")
	}
	if token == "" {
		token = os.Getenv("CERTDAX_AGENT_TOKEN")
	}

	if configPath != "" {
		cfg, err := loadConfig(configPath)
		if err != nil && (apiURL == "" || token == "") {
			log.Fatalf("[FATAL] %v", err)
		} else if err == nil {
			if apiURL == "" {
				apiURL = cfg.APIURL
			}
			if token == "" {
				token = cfg.AgentToken
			}
			if pollInterval == 30 && cfg.PollInterval > 0 {
				pollInterval = cfg.PollInterval
			}
		}
	}

	if apiURL == "" || token == "" {
		fmt.Fprintln(os.Stderr, "Error: API URL and token are required.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Usage:")
		fmt.Fprintln(os.Stderr, "  certdax-agent --api-url URL --token TOKEN")
		fmt.Fprintln(os.Stderr, "  certdax-agent --config /etc/certdax/config.yaml")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Environment variables:")
		fmt.Fprintln(os.Stderr, "  CERTDAX_API_URL    API server URL")
		fmt.Fprintln(os.Stderr, "  CERTDAX_AGENT_TOKEN  Agent token")
		os.Exit(1)
	}

	agent := NewAgent(Config{
		APIURL:       apiURL,
		AgentToken:   token,
		PollInterval: pollInterval,
	})

	// On Windows, detect if launched by the SCM and dispatch accordingly.
	// On Linux/macOS this always returns false and agent.Run() handles SIGTERM.
	isService, err := isWindowsService()
	if err != nil {
		log.Fatalf("[FATAL] Cannot determine service mode: %v", err)
	}
	if isService {
		if err := runAsWindowsService(agent); err != nil {
			log.Fatalf("[FATAL] Windows service exited with error: %v", err)
		}
	} else {
		agent.Run()
	}
}
