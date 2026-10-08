import type { CSSProperties } from 'react';
import {
  DESK_SIZE,
  DOOR,
  FLOOR,
  PLANTS,
  PROPS,
  ROOMS,
  WINDOW_XS,
  WINDOW_Y,
  cursorAbove,
  loungeAt,
  monitorAt,
  plateAt,
  roomFurniture,
  seatAt,
} from './layout';
import type { Point, Room } from './layout';
import type { SceneProps } from '../home/theme';
import type { Placement } from '../home/theme';
import { PixelSprite } from './pixel-sprite';
import { CURSOR, PLANT } from './sprites/characters';
import { FURNITURE, monitorSprite } from './sprites/furniture';
import { officeTokens as t } from './tokens';

export type OfficeFloorProps = SceneProps;

/** Where an agent's sprite stands: in its meeting seat, or behind its own desk. */
function spotOf(placement: Placement): Point {
  return placement.where === 'room' ? placement.seat : seatAt(placement.station);
}

/** Absolute placement on the floor. */
function at({ x, y }: Point): CSSProperties {
  return { position: 'absolute', left: x, top: y };
}

/**
 * The Office theme's scene, seen from the front: desks on the left, glass meeting rooms on
 * the right. Where each agent stands comes in as placements (Home maps engine state to
 * them), every other position comes from the layout module and every piece of furniture is
 * a sprite; this component only draws.
 */
export function OfficeFloor({ members, selectedId, placements }: OfficeFloorProps) {
  const byId = new Map(members.map((member) => [member.pet.id, member]));
  const seated = placements.flatMap((placement) => {
    const member = byId.get(placement.agentId);
    return member === undefined ? [] : [{ placement, desk: placement.station, member }];
  });
  const selected = seated.find(({ member }) => member.pet.id === selectedId);
  const cursor = selected === undefined ? undefined : cursorAbove(spotOf(selected.placement));
  const furniture = t.spriteScale.furniture;

  return (
    <section
      aria-label="Office floor"
      style={{
        width: FLOOR.width,
        flex: 'none',
        overflowX: 'hidden',
        overflowY: 'auto',
        background: t.color.floor,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: FLOOR.width,
          height: FLOOR.height,
          overflow: 'hidden',
          backgroundImage: `linear-gradient(${t.color.floorGrid} 2px, transparent 2px), linear-gradient(90deg, ${t.color.floorGrid} 2px, transparent 2px)`,
          backgroundSize: '32px 32px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: FLOOR.width,
            height: FLOOR.wallHeight,
            background: t.color.wall,
          }}
        />
        {WINDOW_XS.map((x) => (
          <PixelSprite
            key={x}
            sprite={FURNITURE.window}
            scale={furniture}
            style={at({ x, y: WINDOW_Y })}
          />
        ))}

        {ROOMS.map((room) => (
          <MeetingRoom key={room.name} room={room} />
        ))}

        {PLANTS.map((plant) => (
          <PixelSprite
            key={`${plant.x},${plant.y}`}
            sprite={PLANT}
            scale={t.spriteScale.plant}
            style={at(plant)}
          />
        ))}
        {PROPS.map((prop) => (
          <PixelSprite
            key={prop.sprite}
            sprite={FURNITURE[prop.sprite]}
            scale={furniture}
            style={at(prop)}
          />
        ))}

        {loungeAt(members.length).map((piece) => (
          <PixelSprite
            key={`lounge-${piece.x},${piece.y}`}
            sprite={piece.sprite}
            scale={furniture}
            style={at(piece)}
          />
        ))}

        {seated.map(({ placement, member }, index) => (
          <PixelSprite
            key={member.pet.id}
            sprite={member.character.sprite}
            scale={t.spriteScale.floor}
            className="office-bob"
            style={{ ...at(spotOf(placement)), animationDelay: `${index * t.timing.bobStagger}s` }}
          />
        ))}

        {seated.map(({ placement, desk, member }) => {
          const lit = member.status === 'working';
          return (
            <div key={member.pet.id}>
              <PixelSprite sprite={FURNITURE.desk} scale={furniture} style={at(desk)} />
              <span
                data-testid={`monitor-${member.pet.id}`}
                data-lit={lit}
                style={at(monitorAt(desk))}
              >
                <PixelSprite sprite={monitorSprite(lit)} scale={furniture} />
              </span>
              <div
                className="office-px"
                style={{
                  ...at(plateAt(desk)),
                  width: DESK_SIZE.width,
                  textAlign: 'center',
                  fontSize: t.fontSize.min,
                  letterSpacing: t.letterSpacing.pixel,
                  color: t.color.plate,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {member.pet.name.toUpperCase()}
              </div>
              {placement.where === 'marker' && (
                <span
                  data-testid={`needs-you-${member.pet.id}`}
                  style={{
                    ...at(placement.marker),
                    fontSize: t.fontSize.min,
                    fontWeight: t.fontWeight.semibold,
                    padding: `${t.space.xxs}px ${t.space.md}px`,
                    borderRadius: t.radius.chip,
                    background: t.color.gold,
                    color: t.color.goldInk,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Needs you
                </span>
              )}
            </div>
          );
        })}

        {cursor !== undefined && selectedId !== null && (
          <span
            data-testid="office-cursor"
            data-pet-id={selectedId}
            className="office-hop"
            style={at(cursor)}
          >
            <PixelSprite sprite={CURSOR} scale={t.spriteScale.cursor} />
          </span>
        )}
      </div>
    </section>
  );
}

/** A glass meeting room. Meetings arrive in a later phase, so every room is free. */
function MeetingRoom({ room }: { room: Room }) {
  const { table, chairs } = roomFurniture(room);
  // Chairs behind the table are drawn before it, chairs in front after it.
  const behind = chairs.filter((chair) => chair.y < table.y);
  const inFront = chairs.filter((chair) => chair.y >= table.y);
  const chair = (point: Point) => (
    <PixelSprite
      key={`${point.x},${point.y}`}
      sprite={FURNITURE.chair}
      scale={t.spriteScale.furniture}
      style={at(point)}
    />
  );
  return (
    <>
      <div
        style={{
          ...at(room),
          width: room.width,
          height: room.height,
          boxSizing: 'border-box',
          border: `4px solid ${t.color.roomGlass}`,
          background: t.color.roomFill,
          boxShadow: `inset 0 0 0 2px ${t.color.roomShine}`,
        }}
      />
      <div
        style={{
          ...at({ x: room.x - 2, y: room.y + room.height - DOOR.fromBottom }),
          width: DOOR.width,
          height: DOOR.height,
          background: t.color.floor,
        }}
      />
      <div
        style={{
          ...at({ x: room.x + 14, y: room.y + 12 }),
          display: 'flex',
          alignItems: 'center',
          gap: t.space.md,
        }}
      >
        <span
          className="office-px"
          style={{
            fontSize: t.fontSize.roomName,
            fontWeight: t.fontWeight.bold,
            letterSpacing: t.letterSpacing.pixel,
            color: t.color.roomLabel,
          }}
        >
          {room.name}
        </span>
        <span
          style={{
            fontSize: t.fontSize.min,
            fontWeight: t.fontWeight.semibold,
            padding: `${t.space.xxs}px ${t.space.md}px`,
            borderRadius: t.radius.chip,
            background: t.color.chipFree,
            color: t.color.chipFreeInk,
          }}
        >
          Free
        </span>
      </div>
      {behind.map(chair)}
      <PixelSprite
        sprite={FURNITURE.meetingTable}
        scale={t.spriteScale.furniture}
        style={at(table)}
      />
      {inFront.map(chair)}
    </>
  );
}
