account TicTacToeConfig {
    authority: pubkey;
    turn_timeout_secs: u64;
    allow_open_matches: u64;
    allow_invites: u64;
    match_nonce: u64;
}

account MatchState {
    status: u64;
    player1: pubkey;
    player2: pubkey;
    invited_player: pubkey;
    invited_required: bool;
    current_turn: u64;
    winner: u64;
    last_move_index: u64;
    move_count: u64;
    turn_timeout_secs: u64;
    turn_deadline_ts: u64;
    created_at_ts: u64;
    started_at_ts: u64;
    ended_at_ts: u64;
    ttt_p1_bits: u64;
    ttt_p2_bits: u64;
}

account PlayerProfile {
    authority: pubkey;
    games_played: u64;
    wins: u64;
    losses: u64;
    draws: u64;
    timeouts_claimed: u64;
}

fn now_slot() -> u64 {
    return get_clock().slot;
}

fn seat_of(match_state: MatchState, key: pubkey) -> u64 {
    if match_state.player1 == key {
        return 1;
    }
    if match_state.player2 == key {
        return 2;
    }
    return 0;
}

pub init_config(
    config: TicTacToeConfig @mut,
    authority: account @signer,
    turn_timeout_secs: u64,
    allow_open_matches: u64,
    allow_invites: u64
) {
    config.authority = authority.ctx.key;
    if turn_timeout_secs == 0 {
        config.turn_timeout_secs = 120;
    } else {
        config.turn_timeout_secs = turn_timeout_secs;
    }
    config.allow_open_matches = allow_open_matches;
    config.allow_invites = allow_invites;
    config.match_nonce = 0;
}

pub init_profile(
    profile: PlayerProfile @mut,
    owner: account @signer
) {
    profile.authority = owner.ctx.key;
    profile.games_played = 0;
    profile.wins = 0;
    profile.losses = 0;
    profile.draws = 0;
    profile.timeouts_claimed = 0;
}

pub create_open_match(
    config: TicTacToeConfig @mut,
    match_state: MatchState @mut,
    player1: account @signer
) {
    config.match_nonce = config.match_nonce + 1;

    match_state.status = 0;
    match_state.player1 = player1.ctx.key;
    match_state.player2 = player1.ctx.key;
    match_state.invited_player = player1.ctx.key;
    match_state.invited_required = false;
    match_state.current_turn = 1;
    match_state.winner = 0;
    match_state.last_move_index = 0;
    match_state.move_count = 0;
    if config.turn_timeout_secs == 0 {
        match_state.turn_timeout_secs = 120;
    } else {
        match_state.turn_timeout_secs = config.turn_timeout_secs;
    }
    match_state.turn_deadline_ts = 0;
    match_state.created_at_ts = now_slot();
    match_state.started_at_ts = 0;
    match_state.ended_at_ts = 0;
    match_state.ttt_p1_bits = 0;
    match_state.ttt_p2_bits = 0;
}

pub create_invite_match(
    config: TicTacToeConfig @mut,
    match_state: MatchState @mut,
    player1: account @signer,
    invited_player: account
) {
    config.match_nonce = config.match_nonce + 1;

    match_state.status = 0;
    match_state.player1 = player1.ctx.key;
    match_state.player2 = player1.ctx.key;
    match_state.invited_player = invited_player.ctx.key;
    match_state.invited_required = true;
    match_state.current_turn = 1;
    match_state.winner = 0;
    match_state.last_move_index = 0;
    match_state.move_count = 0;
    if config.turn_timeout_secs == 0 {
        match_state.turn_timeout_secs = 120;
    } else {
        match_state.turn_timeout_secs = config.turn_timeout_secs;
    }
    match_state.turn_deadline_ts = 0;
    match_state.created_at_ts = now_slot();
    match_state.started_at_ts = 0;
    match_state.ended_at_ts = 0;
    match_state.ttt_p1_bits = 0;
    match_state.ttt_p2_bits = 0;
}

pub join_match(
    config: TicTacToeConfig,
    match_state: MatchState @mut,
    player2: account @signer
) {
    require(config.allow_open_matches == 1 || config.allow_invites == 1);
    require(match_state.status == 0);
    require(match_state.player1 != player2.ctx.key);

    if match_state.invited_required {
        require(match_state.invited_player == player2.ctx.key);
    }

    match_state.player2 = player2.ctx.key;
    match_state.status = 1;
    match_state.current_turn = 1;

    let now = now_slot();
    match_state.started_at_ts = now;
    match_state.turn_deadline_ts = now + match_state.turn_timeout_secs;
}

pub start_single_player(
    match_state: MatchState @mut,
    caller: account @signer
) {
    require(match_state.status == 0);
    require(caller.ctx.key == match_state.player1);

    match_state.player2 = caller.ctx.key;
    match_state.status = 1;
    match_state.current_turn = 1;

    let now = now_slot();
    match_state.started_at_ts = now;
    match_state.turn_deadline_ts = now + match_state.turn_timeout_secs;
}

pub play_ttt(
    match_state: MatchState @mut,
    caller: account @signer,
    cell_index: u64
) {
    require(match_state.status == 1);
    require(cell_index < 9);

    let seat = seat_of(match_state, caller.ctx.key);
    require(seat == 1 || seat == 2);
    require(seat == match_state.current_turn);

    match_state.last_move_index = cell_index;
    match_state.move_count = match_state.move_count + 1;

    if seat == 1 {
        match_state.current_turn = 2;
    } else {
        match_state.current_turn = 1;
    }

    if match_state.move_count >= 9 {
        match_state.status = 4;
        match_state.winner = 0;
        match_state.ended_at_ts = now_slot();
    } else {
        let now = now_slot();
        match_state.turn_deadline_ts = now + match_state.turn_timeout_secs;
    }
}

pub play_ttt_single(
    match_state: MatchState @mut,
    caller: account @signer,
    cell_index: u64
) {
    play_ttt(match_state, caller, cell_index);

    if match_state.status != 1 {
        return;
    }
    if match_state.current_turn != 2 {
        return;
    }

    match_state.last_move_index = (cell_index + 1) % 9;
    match_state.move_count = match_state.move_count + 1;
    if match_state.move_count >= 9 {
        match_state.status = 4;
        match_state.winner = 0;
        match_state.ended_at_ts = now_slot();
        return;
    }

    match_state.current_turn = 1;
    let now = now_slot();
    match_state.turn_deadline_ts = now + match_state.turn_timeout_secs;
}

pub play_cpu_random(
    match_state: MatchState @mut,
    caller: account @signer
) {
    require(match_state.status == 1);
    require(caller.ctx.key == match_state.player1);
    require(match_state.current_turn == 2);

    let next = match_state.last_move_index + 1;
    match_state.last_move_index = next % 9;
    match_state.move_count = match_state.move_count + 1;

    if match_state.move_count >= 9 {
        match_state.status = 4;
        match_state.winner = 0;
        match_state.ended_at_ts = now_slot();
        return;
    }

    match_state.current_turn = 1;
    let now = now_slot();
    match_state.turn_deadline_ts = now + match_state.turn_timeout_secs;
}

pub claim_timeout(
    match_state: MatchState @mut,
    caller: account @signer
) {
    require(match_state.status == 1);

    let seat = seat_of(match_state, caller.ctx.key);
    require(seat == 1 || seat == 2);

    if seat == 1 {
        match_state.status = 2;
        match_state.winner = 1;
    } else {
        match_state.status = 3;
        match_state.winner = 2;
    }
    match_state.ended_at_ts = now_slot();
}

pub resign(
    match_state: MatchState @mut,
    caller: account @signer
) {
    require(match_state.status == 1);

    let seat = seat_of(match_state, caller.ctx.key);
    require(seat == 1 || seat == 2);

    if seat == 1 {
        match_state.status = 3;
        match_state.winner = 2;
    } else {
        match_state.status = 2;
        match_state.winner = 1;
    }
    match_state.ended_at_ts = now_slot();
}

pub cancel_waiting_match(
    match_state: MatchState @mut,
    caller: account @signer
) {
    require(match_state.status == 0);
    require(caller.ctx.key == match_state.player1);

    match_state.status = 5;
    match_state.winner = 0;
    match_state.ended_at_ts = now_slot();
}

pub get_match_status(match_state: MatchState) -> u64 {
    return match_state.status;
}

pub get_match_turn(match_state: MatchState) -> u64 {
    return match_state.current_turn;
}

pub get_match_winner(match_state: MatchState) -> u64 {
    return match_state.winner;
}
