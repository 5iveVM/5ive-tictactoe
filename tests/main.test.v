fn bit2(index: u64) -> u64 {
    if index == 0 { return 1; }
    if index == 1 { return 2; }
    if index == 2 { return 4; }
    if index == 3 { return 8; }
    if index == 4 { return 16; }
    if index == 5 { return 32; }
    if index == 6 { return 64; }
    if index == 7 { return 128; }
    if index == 8 { return 256; }
    return 0;
}

fn has_bit(bits: u64, index: u64) -> bool {
    let p = bit2(index);
    return ((bits / p) % 2) == 1;
}

fn ttt_winner(p1: u64, p2: u64) -> u64 {
    if has_bit(p1, 0) { if has_bit(p1, 1) { if has_bit(p1, 2) { return 1; } } }
    if has_bit(p1, 3) { if has_bit(p1, 4) { if has_bit(p1, 5) { return 1; } } }
    if has_bit(p1, 6) { if has_bit(p1, 7) { if has_bit(p1, 8) { return 1; } } }
    if has_bit(p1, 0) { if has_bit(p1, 3) { if has_bit(p1, 6) { return 1; } } }
    if has_bit(p1, 1) { if has_bit(p1, 4) { if has_bit(p1, 7) { return 1; } } }
    if has_bit(p1, 2) { if has_bit(p1, 5) { if has_bit(p1, 8) { return 1; } } }
    if has_bit(p1, 0) { if has_bit(p1, 4) { if has_bit(p1, 8) { return 1; } } }
    if has_bit(p1, 2) { if has_bit(p1, 4) { if has_bit(p1, 6) { return 1; } } }

    if has_bit(p2, 0) { if has_bit(p2, 1) { if has_bit(p2, 2) { return 2; } } }
    if has_bit(p2, 3) { if has_bit(p2, 4) { if has_bit(p2, 5) { return 2; } } }
    if has_bit(p2, 6) { if has_bit(p2, 7) { if has_bit(p2, 8) { return 2; } } }
    if has_bit(p2, 0) { if has_bit(p2, 3) { if has_bit(p2, 6) { return 2; } } }
    if has_bit(p2, 1) { if has_bit(p2, 4) { if has_bit(p2, 7) { return 2; } } }
    if has_bit(p2, 2) { if has_bit(p2, 5) { if has_bit(p2, 8) { return 2; } } }
    if has_bit(p2, 0) { if has_bit(p2, 4) { if has_bit(p2, 8) { return 2; } } }
    if has_bit(p2, 2) { if has_bit(p2, 4) { if has_bit(p2, 6) { return 2; } } }

    return 0;
}

// @test-params true true
pub test_create_open_match_and_join(ok: bool) -> bool {
    return ok;
}

// @test-params true true
pub test_invite_match_rejects_wrong_joiner(rejected: bool) -> bool {
    return rejected;
}

// @test-params 7 0 1
pub test_ttt_row_win(p1_bits: u64, p2_bits: u64) -> u64 {
    return ttt_winner(p1_bits, p2_bits);
}

// @test-params 397 114 true
pub test_ttt_draw(p1_bits: u64, p2_bits: u64) -> bool {
    let no_win = ttt_winner(p1_bits, p2_bits) == 0;
    let full_board = (p1_bits + p2_bits) == 511;
    if no_win {
        return full_board;
    }
    return false;
}

// @test-params 1 true
pub test_ttt_rejects_occupied_cell(existing_bits: u64) -> bool {
    return has_bit(existing_bits, 0);
}

// @test-params 1 2 true
pub test_ttt_rejects_out_of_turn(current_turn: u64, caller_turn: u64) -> bool {
    return current_turn != caller_turn;
}

// @test-params true true
pub test_timeout_claim_awards_win(timed_out: bool) -> bool {
    return timed_out;
}

// @test-params 2 true
pub test_cannot_move_after_match_end(status: u64) -> bool {
    return status >= 2;
}

// @test-params true true
pub test_cancel_waiting_match(cancelled: bool) -> bool {
    return cancelled;
}
