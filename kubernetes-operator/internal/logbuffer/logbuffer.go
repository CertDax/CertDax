package logbuffer

import (
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap/zapcore"
)

// RingBuffer captures recent log lines in a fixed-size ring buffer.
type RingBuffer struct {
	mu      sync.Mutex
	entries []string
	size    int
	pos     int
	full    bool
}

// New creates a RingBuffer that keeps the last n log lines.
func New(n int) *RingBuffer {
	return &RingBuffer{
		entries: make([]string, n),
		size:    n,
	}
}

// Write adds a formatted log line to the buffer.
func (rb *RingBuffer) Write(line string) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.entries[rb.pos] = line
	rb.pos = (rb.pos + 1) % rb.size
	if rb.pos == 0 {
		rb.full = true
	}
}

// Lines returns all buffered log lines in chronological order.
func (rb *RingBuffer) Lines() []string {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	if !rb.full {
		result := make([]string, rb.pos)
		copy(result, rb.entries[:rb.pos])
		return result
	}
	result := make([]string, rb.size)
	copy(result, rb.entries[rb.pos:])
	copy(result[rb.size-rb.pos:], rb.entries[:rb.pos])
	return result
}

// ZapCore returns a zapcore.Core that writes to this ring buffer.
func (rb *RingBuffer) ZapCore(level zapcore.LevelEnabler) zapcore.Core {
	return &bufferCore{
		buf:   rb,
		level: level,
	}
}

type bufferCore struct {
	buf    *RingBuffer
	level  zapcore.LevelEnabler
	fields []zapcore.Field
}

func (c *bufferCore) Enabled(lvl zapcore.Level) bool {
	return c.level.Enabled(lvl)
}

func (c *bufferCore) With(fields []zapcore.Field) zapcore.Core {
	clone := &bufferCore{
		buf:    c.buf,
		level:  c.level,
		fields: append(append([]zapcore.Field{}, c.fields...), fields...),
	}
	return clone
}

func (c *bufferCore) Check(entry zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(entry.Level) {
		return ce.AddCore(entry, c)
	}
	return ce
}

func (c *bufferCore) Write(entry zapcore.Entry, fields []zapcore.Field) error {
	ts := entry.Time.UTC().Format(time.RFC3339)
	allFields := append(c.fields, fields...)

	line := fmt.Sprintf("%s\t%s\t%s", ts, entry.Level.CapitalString(), entry.Message)
	if entry.LoggerName != "" {
		line = fmt.Sprintf("%s\t%s\t%s\t%s", ts, entry.Level.CapitalString(), entry.LoggerName, entry.Message)
	}

	for _, f := range allFields {
		line += fmt.Sprintf("\t%s=%v", f.Key, fieldValue(f))
	}

	c.buf.Write(line)
	return nil
}

func (c *bufferCore) Sync() error {
	return nil
}

func fieldValue(f zapcore.Field) interface{} {
	switch f.Type {
	case zapcore.StringType:
		return f.String
	case zapcore.Int64Type, zapcore.Int32Type, zapcore.Int16Type, zapcore.Int8Type:
		return f.Integer
	case zapcore.Float64Type:
		return fmt.Sprintf("%g", float64(f.Integer))
	case zapcore.BoolType:
		return f.Integer == 1
	case zapcore.ErrorType:
		if f.Interface != nil {
			return f.Interface.(error).Error()
		}
		return "<nil>"
	case zapcore.DurationType:
		return time.Duration(f.Integer).String()
	default:
		if f.Interface != nil {
			return fmt.Sprintf("%v", f.Interface)
		}
		return f.String
	}
}
