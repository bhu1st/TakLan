package main

import "testing"

func TestNormalizeHostInput(t *testing.T) {
	cases := []struct {
		input   string
		want    string
		wantErr bool
	}{
		{"192.168.1.10", "192.168.1.10:25252", false},
		{" 192.168.1.10:25252 ", "192.168.1.10:25252", false},
		{"ws://192.168.1.10:25252/ws", "192.168.1.10:25252", false},
		{"http://10.0.0.5/discover", "10.0.0.5:25252", false},
		{"", "", true},
		{"192.168.1.10:abc", "", true},
		{"192.168.1.10:99999", "", true},
	}

	for _, tc := range cases {
		got, err := normalizeHostInput(tc.input)
		if (err != nil) != tc.wantErr {
			t.Errorf("normalizeHostInput(%q) err=%v, wantErr=%v", tc.input, err, tc.wantErr)
			continue
		}
		if !tc.wantErr && got != tc.want {
			t.Errorf("normalizeHostInput(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

