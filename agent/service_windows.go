//go:build windows

package main

import (
	"fmt"
	"log"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
)

const _serviceName = "CertDaxAgent"

// certdaxSvc implements the golang.org/x/sys/windows/svc.Handler interface.
type certdaxSvc struct {
	agent *Agent
}

func (s *certdaxSvc) Execute(_ []string, req <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	// Signal the SCM that we are starting up.
	status <- svc.Status{State: svc.StartPending}

	stop := make(chan struct{})
	done := make(chan struct{})

	go func() {
		defer close(done)
		s.agent.runLoop(stop)
	}()

	// Tell the SCM we are running and which control codes we accept.
	status <- svc.Status{
		State:   svc.Running,
		Accepts: svc.AcceptStop | svc.AcceptShutdown,
	}

	for c := range req {
		switch c.Cmd {
		case svc.Stop, svc.Shutdown:
			log.Printf("[INFO] Windows SCM stop/shutdown received")
			status <- svc.Status{State: svc.StopPending}
			close(stop)
			<-done
			return false, 0
		default:
			log.Printf("[WARN] Unexpected SCM control code: %d", c.Cmd)
		}
	}

	return false, 0
}

// isWindowsService reports whether the process was started by the Windows SCM.
func isWindowsService() (bool, error) {
	return svc.IsWindowsService()
}

// runAsWindowsService blocks until the SCM tells us to stop.
func runAsWindowsService(agent *Agent) error {
	// Also log to the Windows Event Log so errors show in Event Viewer.
	el, err := eventlog.Open(_serviceName)
	if err == nil {
		defer el.Close()
		_ = el.Info(1, fmt.Sprintf("CertDax Agent service starting (version %s)", version))
	}

	if err := svc.Run(_serviceName, &certdaxSvc{agent: agent}); err != nil {
		if el != nil {
			_ = el.Error(1, fmt.Sprintf("CertDax Agent service failed: %v", err))
		}
		return err
	}
	return nil
}
